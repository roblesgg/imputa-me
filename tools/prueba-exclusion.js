// ¿Respeta Desktop Duplication la exclusión de captura (setContentProtection)? Pone una ventana
// ROJA con protección encima de una zona, la captura con src/captura-dxgi.js y mira cuánto rojo
// sale. Debe salir ~0 % (la ventana no aparece en la captura). La ventana se ve ~1 s.
//   (sin ELECTRON_RUN_AS_NODE)  electron tools/prueba-exclusion.js
const { app, BrowserWindow, screen } = require('electron');
const { CapturaDXGI } = require('../src/captura-dxgi');
const espera = (ms) => new Promise(r => setTimeout(r, ms));

function porcentajeRojo(f) {
  let rojos = 0, total = 0;
  for (let y = 0; y < f.alto; y += 2) for (let x = 0; x < f.ancho; x += 2) {
    const i = y * f.paso + x * 4;   // BGRA
    const b = f.datos[i], g = f.datos[i + 1], r = f.datos[i + 2];
    if (r > 200 && g < 60 && b < 60) rojos++;
    total++;
  }
  return (100 * rojos / total).toFixed(1);
}

async function medir(protegida) {
  const d = screen.getPrimaryDisplay(), work = d.workArea;
  const win = new BrowserWindow({ x: work.x + 60, y: work.y + 60, width: 300, height: 200, frame: false, show: false,
    alwaysOnTop: true, skipTaskbar: true, backgroundColor: '#ff0000', webPreferences: { contextIsolation: true } });
  if (protegida) win.setContentProtection(true);
  win.showInactive();
  await espera(500);
  const fis = screen.dipToScreenRect(null, win.getBounds());
  console.log('  ventana mostrada, protegida=', protegida, fis);
  const c = CapturaDXGI.crear({ x: fis.x + 20, y: fis.y + 20, w: fis.width - 40, h: fis.height - 40 });
  console.log('  captura creada:', !!c);
  let f = null;
  for (let i = 0; i < 40 && !f; i++) { f = c && c.leer(); if (!f) await espera(10); }
  const res = f ? porcentajeRojo(f) + '% rojo' : 'sin fotograma';
  if (c) c.cerrar();
  win.destroy();
  return res;
}

app.on('window-all-closed', () => {});   // que no se cierre al destruir la ventana de prueba
app.whenReady().then(async () => {
  console.log('sin protección (debe salir rojo):', await medir(false));
  console.log('con protección (debe salir ~0%):', await medir(true));
  app.quit();
});
