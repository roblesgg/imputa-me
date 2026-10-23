// Prueba aislada: ¿aplica Windows el desenfoque del compositor (SetWindowCompositionAttribute)
// a una ventana transparente de Electron recortada con setShape? Abre una ventanita ~1 s abajo
// a la izquierda, hace una foto de esa zona de la pantalla y la guarda.
//   (sin ELECTRON_RUN_AS_NODE)  electron tools/prueba-acrilico.js <salida.png> [estado=4]
const { app, BrowserWindow, desktopCapturer, screen } = require('electron');
const fs = require('fs');
const { aplicarDesenfoqueWindows, esquinasWindows } = require('../desenfoque-windows');

const [salida = 'acrilico.png', estado = '4'] = process.argv.slice(2).filter(a => !a.startsWith('--'));

app.whenReady().then(async () => {
  const work = screen.getPrimaryDisplay().workArea;
  const W = 360, H = 220;
  const win = new BrowserWindow({
    x: work.x + 40, y: work.y + work.height - H - 40, width: W, height: H,
    frame: false, transparent: true, backgroundColor: '#00000000', hasShadow: false,
    resizable: false, skipTaskbar: true, alwaysOnTop: true, show: false, roundedCorners: false,
    webPreferences: { contextIsolation: true },
  });
  await win.loadURL('data:text/html,' + encodeURIComponent(`<html><body style="margin:0;background:transparent;font:600 20px Segoe UI;color:white">
    <div style="position:absolute;inset:20px;border-radius:24px;box-shadow:inset 0 0 0 1px rgba(255,255,255,.5);display:grid;place-items:center">desenfoque</div></body></html>`));
  if (estado !== 'r') win.setShape([{ x: 20, y: 20, width: W - 40, height: H - 40 }]);
  else console.log('esquinas', esquinasWindows(win, 2));
  const ok = aplicarDesenfoqueWindows(win, { estado: estado === 'r' ? 3 : Number(estado), tinte: 0x20201a1d });
  console.log('aplicado', ok);
  win.showInactive();
  await new Promise(r => setTimeout(r, 900));
  const disp = screen.getPrimaryDisplay(), sf = disp.scaleFactor;
  const fuentes = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: Math.round(disp.bounds.width * sf), height: Math.round(disp.bounds.height * sf) } });
  const src = fuentes.find(s => String(s.display_id) === String(disp.id)) || fuentes[0];
  const b = win.getBounds();
  const img = src.thumbnail.crop({ x: Math.round((b.x - disp.bounds.x - 30) * sf), y: Math.round((b.y - disp.bounds.y - 30) * sf), width: Math.round((W + 60) * sf), height: Math.round((H + 60) * sf) });
  fs.writeFileSync(salida, img.toPNG());
  console.log('captura', salida);
  win.destroy();
  app.quit();
});
