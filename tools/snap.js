// Captura una vista de la app SIN abrir ninguna ventana (renderizado offscreen), con un estado
// de ejemplo y el tema que se pida. Sirve para revisar el diseño desde la terminal.
//
//   (sin ELECTRON_RUN_AS_NODE)  electron tools/snap.js <pagina.html> <salida.png> [tema] [ancho] [alto] [js-antes-de-capturar]
//
// El estado sale de los datos reales del usuario (solo lectura: no se escribe nada) o, si no hay,
// de unos de ejemplo. El fondo de escritorio que se ve detrás del acrílico se simula con un
// degradado, porque fuera de Windows no hay acrílico que valga.
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

app.setPath('userData', path.join(os.tmpdir(), 'imputame-snap'));
app.commandLine.appendSwitch('force-device-scale-factor', '1');

const RAIZ = path.join(__dirname, '..');
const { themeVars } = require(path.join(RAIZ, 'themes'));
const { GROUP_PALETTES } = require(path.join(RAIZ, 'palettes'));

const [pagina = 'main.html', salida = 'snap.png', tema = 'noche', ancho = '460', alto = '900', antes = ''] = process.argv.slice(2).filter(a => !a.startsWith('--'));

function leerJson(p, porDefecto) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return porDefecto; } }
const dir = path.join(process.env.APPDATA || '', 'imputa-me');
const datos = leerJson(path.join(dir, 'imputa-tasks.json'), { tasks: [], groups: [], activeTaskId: null });
const ajustes = { ...leerJson(path.join(dir, 'imputa-settings.json'), {}), theme: tema, accent: null, bgOpacity: 10, tutorialSeenSteps: [] };
// Sin tutorial en las capturas: todos los pasos por vistos.
try {
  const shared = fs.readFileSync(path.join(RAIZ, 'src', 'shared.js'), 'utf8');
  ajustes.tutorialSeenSteps = [...shared.matchAll(/id:'([a-z0-9-]+)'/g)].map(m => m[1]);
} catch {}

function estado() {
  const hoy0 = new Date(); hoy0.setHours(0, 0, 0, 0);
  const segs = (t, desde) => (t.entries || []).reduce((s, e) => {
    const a = Math.max(e.start, desde || 0), b = e.end || Date.now();
    return s + Math.max(0, (b - a) / 1000);
  }, 0);
  return {
    tasks: (datos.tasks || []).map(t => ({
      ...t,
      todaySecs: segs(t, hoy0.getTime()), totalSecs: segs(t, 0),
      inTrash: !!(t.deleted && !t.purged), inactive: false,
      subtasks: (t.subtasks || []).map(s => ({ ...s, todaySecs: 0, totalSecs: 0 })),
      ownTodaySecs: segs(t, hoy0.getTime()),
    })),
    groups: datos.groups || [],
    palettes: GROUP_PALETTES,
    activeTaskId: datos.activeTaskId || null,
    activeSubId: datos.activeSubId || null,
    todayTotal: 0,
    settings: ajustes,
    updateAvailable: null,
    trashRetentionDays: 30,
  };
}

// Para probar el panel del dock: el calendario es más ancho que el resto, como en main.js.
const ANCHO_VISTA = { panel: 460, calendar: 900, groups: 460, settings: 460 };
let pendienteEncoger = null;
ipcMain.on('action', (event, { type, payload } = {}) => {
  try {
    if (type === 'get-state') event.reply('state', estado());
    else if (type === 'get-theme') event.reply('theme', themeVars(ajustes));
    else if (type === 'am-i-visible') event.reply('dock-expanded');
    else if (type === 'get-settings') event.reply('settings', ajustes);
    else if (type === 'dock-view-changed') {
      const win = BrowserWindow.fromWebContents(event.sender);
      const [w, h] = win.getSize();
      const nuevo = ANCHO_VISTA[payload.view] || 460;
      if (nuevo === w) { event.reply('dock-panel-resized', { cambiaTamano: false }); return; }
      const crece = nuevo > w;
      if (crece) win.setSize(nuevo, h); else pendienteEncoger = () => win.setSize(nuevo, h);
      event.reply('dock-panel-resized', { cambiaTamano: true, crece, hasta: { w: nuevo, h } });
    } else if (type === 'dock-panel-encogido' && pendienteEncoger) { pendienteEncoger(); pendienteEncoger = null; }
  } catch {}
});
ipcMain.handle('sync-status', () => ({ loggedIn: false, email: null }));
['export-csv', 'export-backup', 'import-backup', 'apply-import-backup', 'sync-login', 'sync-logout']
  .forEach(c => { try { ipcMain.handle(c, () => null); } catch {} });
// La foto para el cristal líquido, igual que en main.js (también desde un iframe del dock).
const VISTAS = { panel: 'main.html', calendar: 'calendar.html', groups: 'groups.html', settings: 'settings.html' };
ipcMain.handle('capture-region', async (event) => {
  const wc = event.sender;
  const frame = event.senderFrame;
  const vista = frame && frame.parent ? Object.keys(VISTAS).find(v => (frame.url || '').includes(VISTAS[v])) : null;
  const sitio = await wc.executeJavaScript(`(() => {
    const f = ${vista ? `document.querySelector('iframe[data-view="${vista}"]')` : 'null'};
    const r = f ? f.getBoundingClientRect() : { left: 0, top: 0 };
    return { iw: innerWidth, ih: innerHeight, x: r.left, y: r.top };
  })()`);
  const img = await wc.capturePage();
  const data = img.toBitmap();
  let { width: pw, height: ph } = img.getSize();
  if (data.length !== pw * ph * 4) {
    const s = Math.sqrt(data.length / 4 / (pw * ph));
    pw = Math.round(pw * s); ph = Math.round(ph * s);
  }
  return { data, pw, ph, iw: sitio.iw, ih: sitio.ih, offX: sitio.x, offY: sitio.y };
});

// La captura nativa del cristal (src/captura-dxgi.js) lee la pantalla real: aquí solo hace falta
// decirle dónde está la pantalla principal (la ventana de la captura no se ve en pantalla).
ipcMain.handle('fuente-dxgi', () => {
  const { screen } = require('electron');
  const d = screen.getPrimaryDisplay();
  const fis = screen.dipToScreenRect(null, d.bounds);
  return { dip: d.bounds, fis, sf: fis.width / d.bounds.width };
});

// Lo de detrás de la ventana (el recordatorio): un escritorio de mentira con manchas de
// color, en BGRA como lo da toBitmap en Windows.
ipcMain.handle('capture-desktop', async (event) => {
  const { w, h, x, y } = await event.sender.executeJavaScript('({ w: innerWidth, h: innerHeight, x: screenX, y: screenY })');
  const data = Buffer.alloc(w * h * 4);
  const manchas = [[0.15, 0.3, 0.45, [255, 122, 89]], [0.7, 0.95, 0.55, [91, 140, 255]], [0.95, 0.05, 0.35, [255, 209, 102]], [0.45, 0.6, 0.3, [48, 196, 141]]];
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    let c = [42, 35, 64];
    manchas.forEach(([mx, my, r, col]) => {
      const d = Math.hypot(i / w - mx, (j / h - my) * h / w) / r;
      const a = Math.max(0, 1 - d * d);
      c = c.map((v, k) => v + (col[k] - v) * a);
    });
    const o = (j * w + i) * 4;
    data[o] = c[2]; data[o + 1] = c[1]; data[o + 2] = c[0]; data[o + 3] = 255;
  }
  return { data, pw: w, ph: h, region: { x, y, w, h } };
});

app.whenReady().then(() => {
  const win = new BrowserWindow({
    width: Number(ancho), height: Number(alto), show: false,
    webPreferences: { offscreen: true, nodeIntegration: true, contextIsolation: false, nodeIntegrationInSubFrames: true },
  });
  win.webContents.setFrameRate(30);
  const claro = themeVars(ajustes).scheme === 'light';
  const fondo = claro
    ? 'radial-gradient(80% 60% at 20% 10%, #f4d9c8, transparent 70%), radial-gradient(70% 60% at 90% 90%, #d9d4f4, transparent 70%), #ece8e4'
    : 'radial-gradient(80% 60% at 20% 10%, #3a2a24, transparent 70%), radial-gradient(70% 60% at 90% 90%, #2a2438, transparent 70%), #141214';
  const url = path.join(RAIZ, 'src', pagina.split('?')[0]);
  const query = pagina.includes('?') ? pagina.split('?')[1] : '';
  win.loadFile(url, query ? { search: query } : undefined);
  win.webContents.on('did-finish-load', async () => {
    try { await win.webContents.insertCSS(`html { background: ${fondo} !important; }`); } catch {}
    win.webContents.send('settings', ajustes);
    await new Promise(r => setTimeout(r, 1600));
    if (antes) {
      try { await win.webContents.executeJavaScript(antes); } catch (e) { console.error('JS:', e.message); }
      await new Promise(r => setTimeout(r, Number(process.env.SNAP_WAIT) || 1400));
    }
    const img = await win.webContents.capturePage();
    fs.writeFileSync(salida, img.toPNG());
    console.log('captura', salida, img.getSize());
    app.quit();
  });
  win.webContents.on('console-message', (_e, nivel, msg, linea, fuente) => {
    if (nivel >= 1 || String(msg).startsWith('[snap]')) console.log(`[consola] ${msg} (${path.basename(String(fuente || ''))}:${linea})`);
  });
  setTimeout(() => { console.error('tiempo agotado'); app.quit(); }, 25000);
});
