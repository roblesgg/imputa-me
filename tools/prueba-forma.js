// Prueba: ventana como la del panel (toda el área de trabajo, transparente, siempre encima),
// recortada con setShape y con el desenfoque de Windows. ¿Respeta Windows la forma?
//   (sin ELECTRON_RUN_AS_NODE)  electron tools/prueba-forma.js <salida.png> <variante>
// variante: a = forma y luego desenfoque · b = desenfoque y luego forma · c = forma cambiando 30 veces
//           d = como b pero mostrando la ventana antes de todo
const { app, BrowserWindow, desktopCapturer, screen } = require('electron');
const fs = require('fs');
const { aplicarDesenfoqueWindows, ponerRegionWindows } = require('../desenfoque-windows');

const [salida = 'forma.png', variante = 'a'] = process.argv.slice(2).filter(a => !a.startsWith('--'));
const espera = (ms) => new Promise(r => setTimeout(r, ms));

app.whenReady().then(async () => {
  const disp = screen.getPrimaryDisplay(), work = disp.workArea;
  const win = new BrowserWindow({
    ...work, frame: false, transparent: !['g','h'].includes(variante), backgroundColor: '#00000000', hasShadow: false,
    resizable: false, movable: false, skipTaskbar: true, alwaysOnTop: true, show: false, roundedCorners: false,
    webPreferences: { contextIsolation: true },
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  await win.loadURL('data:text/html,' + encodeURIComponent(`<html><body style="margin:0;background:transparent">
    <div style="position:absolute;right:0;top:0;bottom:0;width:460px;border-radius:26px 0 0 26px;background:rgba(22,18,21,.4);box-shadow:inset 1px 0 0 rgba(255,255,255,.3)"></div></body></html>`));
  const forma = (w) => [{ x: work.width - w, y: 0, width: w, height: work.height }];
  if (variante === 'd') { win.showInactive(); await espera(200); }
  if (variante === 'a') { win.setShape(forma(460)); aplicarDesenfoqueWindows(win, { estado: 3 }); }
  if (variante === 'b' || variante === 'd') { aplicarDesenfoqueWindows(win, { estado: 3 }); win.setShape(forma(460)); }
  if (variante === 'c') {
    aplicarDesenfoqueWindows(win, { estado: 3 });
    for (let i = 0; i < 30; i++) { win.setShape(forma(460 + (30 - i) * 10)); await espera(16); }
  }
  if (variante === 'g' || variante === 'h') {
    const sf0 = disp.scaleFactor, ww = 460;
    if (variante === 'h') { try { win.setBackgroundMaterial('acrylic'); } catch (e) { console.log('mat', e.message); } }
    else aplicarDesenfoqueWindows(win, { estado: 3 });
    console.log('region', ponerRegionWindows(win, { x: (work.width - ww) * sf0, y: 0, w: ww * sf0, h: work.height * sf0 }, [26 * sf0, 0, 0, 26 * sf0]));
  }
  if (variante === 'e' || variante === 'f') {
    const sf0 = disp.scaleFactor, ww = 460;
    if (variante === 'f') win.showInactive();
    aplicarDesenfoqueWindows(win, { estado: 3 });
    console.log('region', ponerRegionWindows(win, { x: (work.width - ww) * sf0, y: 0, w: ww * sf0, h: work.height * sf0 }, [26 * sf0, 0, 0, 26 * sf0]));
  }
  if (variante !== 'd' && variante !== 'f') win.showInactive();
  await espera(900);
  const sf = disp.scaleFactor;
  const fuentes = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: Math.round(disp.bounds.width * sf / 3), height: Math.round(disp.bounds.height * sf / 3) } });
  const src = fuentes.find(s => String(s.display_id) === String(disp.id)) || fuentes[0];
  fs.writeFileSync(salida, src.thumbnail.toPNG());
  console.log('captura', variante, salida);
  win.destroy();
  app.quit();
});
