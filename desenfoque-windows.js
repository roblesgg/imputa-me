// Desenfoque del propio compositor de Windows detrás de una ventana (el "acrílico" que usan
// la barra de tareas o el menú Inicio). Lo pinta DWM, así que va EXACTAMENTE a la vez que lo
// que hay detrás: cero retraso, sin capturar la pantalla. Se aplica solo dentro de la forma de
// la ventana (setShape), y encima la página pinta el tinte, el canto de luz y los brillos.
//
// Es la API no documentada SetWindowCompositionAttribute (user32), la misma que usan muchas
// apps de escritorio para esto. Se llama con koffi (FFI), sin compilar nada. Si algo falla
// (no es Windows, no está la función...), devuelve false y la app sigue con su cristal de antes.
let api = null;
function cargar() {
  if (api !== null) return api;
  api = false;
  if (process.platform !== 'win32') return api;
  try {
    const koffi = require('koffi');
    const user32 = koffi.load('user32.dll');
    const ACCENT_POLICY = koffi.struct('ACCENT_POLICY', {
      AccentState: 'int', AccentFlags: 'int', GradientColor: 'uint32', AnimationId: 'int',
    });
    const WINCOMPATTRDATA = koffi.struct('WINCOMPATTRDATA', {
      Attribute: 'int', Data: koffi.pointer(ACCENT_POLICY), SizeOfData: 'size_t',
    });
    const fn = user32.func('bool __stdcall SetWindowCompositionAttribute(intptr_t hwnd, WINCOMPATTRDATA *data)');
    api = { fn, tam: koffi.sizeof(ACCENT_POLICY) };
  } catch (e) {
    console.warn('[desenfoque] no disponible:', e && e.message);
  }
  return api;
}

const WCA_ACCENT_POLICY = 19;
// Estados: 0 nada, 3 desenfoque (blur behind), 4 acrílico (desenfoque + ruido + tinte).
// tinte: 0xAABBGGRR (ojo: el orden es ABGR).
function aplicarDesenfoqueWindows(win, { estado = 3, tinte = 0x01000000 } = {}) {
  const a = cargar();
  if (!a || !win || win.isDestroyed()) return false;
  try {
    const buf = win.getNativeWindowHandle();
    const hwnd = buf.length >= 8 ? buf.readBigInt64LE(0) : BigInt(buf.readInt32LE(0));
    return !!a.fn(hwnd, {
      Attribute: WCA_ACCENT_POLICY,
      Data: { AccentState: estado, AccentFlags: estado === 4 ? 2 : 0, GradientColor: tinte >>> 0, AnimationId: 0 },
      SizeOfData: a.tam,
    });
  } catch (e) {
    console.warn('[desenfoque] fallo al aplicar:', e && e.message);
    return false;
  }
}
function quitarDesenfoqueWindows(win) { return aplicarDesenfoqueWindows(win, { estado: 0, tinte: 0 }); }

// Región nativa de la ventana (SetWindowRgn): a diferencia de setShape de Electron, Windows
// recorta con ella también el desenfoque. Rectángulo con esquinas redondeadas (rx, ry en px
// FÍSICOS), o null para quitarla.
let gdi = null;
function cargarGdi() {
  if (gdi !== null) return gdi;
  gdi = false;
  if (process.platform !== 'win32') return gdi;
  try {
    const koffi = require('koffi');
    const g32 = koffi.load('gdi32.dll'), u32 = koffi.load('user32.dll');
    gdi = {
      redonda: g32.func('intptr_t __stdcall CreateRoundRectRgn(int x1, int y1, int x2, int y2, int w, int h)'),
      rect: g32.func('intptr_t __stdcall CreateRectRgn(int x1, int y1, int x2, int y2)'),
      combinar: g32.func('int __stdcall CombineRgn(intptr_t dst, intptr_t a, intptr_t b, int modo)'),
      borrar: g32.func('bool __stdcall DeleteObject(intptr_t obj)'),
      poner: u32.func('int __stdcall SetWindowRgn(intptr_t hwnd, intptr_t rgn, bool redibujar)'),
    };
  } catch (e) {
    console.warn('[region] no disponible:', e && e.message);
  }
  return gdi;
}
function hwndDe(win) {
  const buf = win.getNativeWindowHandle();
  return buf.length >= 8 ? buf.readBigInt64LE(0) : BigInt(buf.readInt32LE(0));
}
// r: { x, y, w, h } en px físicos; radios: [arriba-izq, arriba-der, abajo-der, abajo-izq] físicos.
// Las esquinas sin radio se rellenan con rectángulos (CreateRoundRectRgn redondea las cuatro).
function ponerRegionWindows(win, r, radios) {
  const g = cargarGdi();
  if (!g || !win || win.isDestroyed()) return false;
  try {
    if (!r) return !!g.poner(hwndDe(win), 0n, true);
    const x = Math.round(r.x), y = Math.round(r.y), w = Math.max(1, Math.round(r.w)), h = Math.max(1, Math.round(r.h));
    const rad = Math.max(0, ...(radios || [0]).map(Number));
    let rgn = rad > 0 ? g.redonda(x, y, x + w + 1, y + h + 1, rad * 2, rad * 2) : g.rect(x, y, x + w, y + h);
    if (rad > 0) {
      // Las esquinas que deben ser rectas se tapan con un cuadrado (RGN_OR = 2).
      const [tl, tr, br, bl] = (radios || [0, 0, 0, 0]).map(v => Number(v) > 0);
      const cuadros = [[!tl, x, y], [!tr, x + w - rad, y], [!br, x + w - rad, y + h - rad], [!bl, x, y + h - rad]];
      for (const [hace, cx, cy] of cuadros) {
        if (!hace) continue;
        const c = g.rect(cx, cy, cx + rad, cy + rad);
        g.combinar(rgn, rgn, c, 2);
        g.borrar(c);
      }
    }
    // SetWindowRgn se queda la región: no se borra después (lo hace Windows).
    return !!g.poner(hwndDe(win), rgn, true);
  } catch (e) {
    console.warn('[region] fallo:', e && e.message);
    return false;
  }
}

// Esquinas redondeadas que pone el propio Windows 11 (DWMWA_WINDOW_CORNER_PREFERENCE): recortan
// también el desenfoque, a diferencia de las regiones. tipo: 2 = redondas (8 px), 3 = pequeñas
// (4 px), 1 = rectas.
let dwm = null;
function esquinasWindows(win, tipo = 2) {
  if (dwm === null) {
    dwm = false;
    if (process.platform === 'win32') {
      try {
        const koffi = require('koffi');
        dwm = { fn: koffi.load('dwmapi.dll').func('int __stdcall DwmSetWindowAttribute(intptr_t hwnd, uint32_t attr, _In_ int *valor, uint32_t tam)') };
      } catch (e) { console.warn('[esquinas] no disponible:', e && e.message); }
    }
  }
  if (!dwm || !win || win.isDestroyed()) return false;
  try { return dwm.fn(hwndDe(win), 33, [tipo], 4) === 0; } catch { return false; }
}

module.exports = { aplicarDesenfoqueWindows, quitarDesenfoqueWindows, ponerRegionWindows, esquinasWindows };
