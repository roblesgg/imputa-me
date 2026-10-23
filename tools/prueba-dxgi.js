// Prueba de src/captura-dxgi.js SIN ventanas visibles: captura una zona de la pantalla con
// Desktop Duplication (en el proceso principal y en un renderer oculto), guarda la imagen y
// mide cuánto tarda cada lectura y lo "viejo" que llega cada fotograma.
//   (sin ELECTRON_RUN_AS_NODE)  electron tools/prueba-dxgi.js <salida.png>
const { app, BrowserWindow, screen, nativeImage } = require('electron');
const fs = require('fs');
const path = require('path');
const { CapturaDXGI } = require('../src/captura-dxgi');

const [salida = 'dxgi.png'] = process.argv.slice(2).filter(a => !a.startsWith('--'));

function aPng(f) {
  // BGRA con relleno por fila (paso) → BGRA compacto, que es lo que espera createFromBitmap.
  const out = Buffer.alloc(f.ancho * f.alto * 4);
  for (let y = 0; y < f.alto; y++) Buffer.from(f.datos.buffer, f.datos.byteOffset + y * f.paso, f.ancho * 4).copy(out, y * f.ancho * 4);
  return nativeImage.createFromBitmap(out, { width: f.ancho, height: f.alto }).toPNG();
}

app.whenReady().then(async () => {
  const d = screen.getPrimaryDisplay();
  const fis = screen.dipToScreenRect(null, d.bounds);
  const zona = { x: fis.x + fis.width - 700, y: fis.y + 100, w: 600, h: 400 };
  console.log('pantalla física', fis, 'zona', zona);

  // 1) En el proceso principal.
  const t0 = performance.now();
  const c = CapturaDXGI.crear(zona, { mitad: process.env.MITAD === '1' });
  console.log('crear (principal):', !!c, (performance.now() - t0).toFixed(1), 'ms', c ? '' : '(falló)');
  if (c) {
    let f = null, intentos = 0;
    const tiempos = [];
    while (intentos < 120) {
      const a = performance.now();
      const r = c.leer();
      const b = performance.now();
      if (r) { f = r; tiempos.push({ ms: b - a, edad: r.edadMs }); }
      intentos++;
      await new Promise(res => setTimeout(res, 8));
    }
    console.log('fotogramas nuevos en ~1 s:', tiempos.length);
    if (tiempos.length) {
      const med = (xs) => xs.sort((p, q) => p - q)[Math.floor(xs.length / 2)];
      console.log('leer() mediana ms:', med(tiempos.map(t => t.ms)).toFixed(2), '· edad del fotograma mediana ms:', med(tiempos.map(t => t.edad)).toFixed(2));
    }
    if (f) { fs.writeFileSync(salida, aPng(f)); console.log('captura', salida, f.ancho + 'x' + f.alto, 'paso', f.paso); }
    else console.log('sin fotogramas (pantalla quieta): normal si nada se movió');
    c.cerrar();
  }

  // 2) En un renderer oculto (donde lo usará el cristal).
  const w = new BrowserWindow({ show: false, webPreferences: { nodeIntegration: true, contextIsolation: false } });
  await w.loadURL('data:text/html,<html><body></body></html>');
  const ruta = JSON.stringify(path.join(__dirname, '..', 'src', 'captura-dxgi.js'));
  const r = await w.webContents.executeJavaScript(`(async () => {
    const { CapturaDXGI } = require(${ruta});
    const c = CapturaDXGI.crear(${JSON.stringify(zona)});
    if (!c) return 'no se pudo crear en el renderer';
    let n = 0, t = 0;
    for (let i = 0; i < 90; i++) { const a = performance.now(); const f = c.leer(); t += performance.now() - a; if (f) n++; await new Promise(r => setTimeout(r, 10)); }
    c.cerrar();
    return 'renderer ok: ' + n + ' fotogramas, leer() medio ' + (t / 90).toFixed(2) + ' ms';
  })()`);
  console.log(r);
  app.quit();
});
