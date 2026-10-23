// ¿Está el usuario haciendo una captura de pantalla? (proceso principal)
//
// El cristal instantáneo lee la pantalla de detrás de su ventana, y para no verse a sí mismo la
// ventana va "excluida de capturas" (setContentProtection). Efecto secundario: tampoco sale en
// las capturas del usuario. Este vigilante detecta cuándo va a hacer una y avisa para quitar la
// exclusión un momento (el cristal se congela en su último fotograma mientras tanto).
//
// Sin ganchos de teclado (un gancho lento retrasa el teclado de TODO el sistema): se mira cada
// 40 ms el estado de las teclas (GetAsyncKeyState) y cada 300 ms qué programa está delante.
// Cubre Win+Mayús+S, Impr Pant (que en Windows 11 abre el recorte) y las herramientas de
// captura conocidas mientras están en primer plano.
'use strict';

const HERRAMIENTAS = /^(screenclippinghost|snippingtool|sharex|greenshot|lightshot|snagit32|snagiteditor|screensketch|flameshot|picpick)\.exe$/i;

let api = null;
function cargar() {
  if (api !== null) return api;
  api = false;
  if (process.platform !== 'win32') return api;
  try {
    const koffi = require('koffi');
    const u32 = koffi.load('user32.dll'), k32 = koffi.load('kernel32.dll');
    api = {
      tecla: u32.func('int16 __stdcall GetAsyncKeyState(int vKey)'),
      delante: u32.func('intptr_t __stdcall GetForegroundWindow()'),
      pidDe: u32.func('uint32 __stdcall GetWindowThreadProcessId(intptr_t hwnd, _Out_ uint32 *pid)'),
      abrir: k32.func('intptr_t __stdcall OpenProcess(uint32 acceso, int heredar, uint32 pid)'),
      nombre: k32.func('int __stdcall QueryFullProcessImageNameW(intptr_t proc, uint32 flags, _Out_ uint16 *buf, _Inout_ uint32 *tam)'),
      cerrar: k32.func('int __stdcall CloseHandle(intptr_t h)'),
    };
  } catch (e) {
    console.warn('[capturas] no disponible:', e && e.message);
  }
  return api;
}

function pulsada(vk) { return (api.tecla(vk) & 0x8000) !== 0; }

function programaDelante() {
  try {
    const hwnd = api.delante();
    if (!hwnd) return '';
    const pid = [0];
    api.pidDe(hwnd, pid);
    if (!pid[0]) return '';
    const h = api.abrir(0x1000 /* PROCESS_QUERY_LIMITED_INFORMATION */, 0, pid[0]);
    if (!h) return '';
    try {
      const buf = new Uint16Array(520), tam = [520];
      if (!api.nombre(h, 0, buf, tam)) return '';
      const ruta = String.fromCharCode(...buf.subarray(0, tam[0]));
      return ruta.slice(ruta.lastIndexOf('\\') + 1);
    } finally { api.cerrar(h); }
  } catch { return ''; }
}

// alCambiar(true) cuando empieza una captura; alCambiar(false) cuando ha terminado (sin la
// herramienta delante y al menos `margenMs` después de la última tecla).
function vigilarCapturas(alCambiar, { margenMs = 1800 } = {}) {
  if (!cargar()) return () => {};
  let activa = false, hastaMs = 0, cuenta = 0, herramienta = false;
  const t = setInterval(() => {
    const ahora = Date.now();
    const winTecla = pulsada(0x5B) || pulsada(0x5C);
    const combinacion = winTecla && pulsada(0x10) && pulsada(0x53);   // Win + Mayús + S
    const imprPant = pulsada(0x2C);
    if (combinacion || imprPant) hastaMs = ahora + margenMs;
    if (++cuenta % 8 === 0) herramienta = HERRAMIENTAS.test(programaDelante());
    if (herramienta) hastaMs = Math.max(hastaMs, ahora + 600);
    const ahoraActiva = ahora < hastaMs;
    if (ahoraActiva !== activa) { activa = ahoraActiva; try { alCambiar(activa); } catch {} }
  }, 40);
  return () => clearInterval(t);
}

module.exports = { vigilarCapturas, programaDelante: () => (cargar() ? programaDelante() : '') };
