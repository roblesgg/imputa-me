// Captura de UNA ZONA de la pantalla con DXGI Desktop Duplication, desde JavaScript (koffi),
// para el cristal líquido (glass.js). Es la misma API que usan los programas de grabación: la
// GPU entrega cada fotograma del escritorio en cuanto Windows lo compone, y de él se copia solo
// el rectángulo que hay detrás del cristal. Comparado con getUserMedia (el vídeo de Chromium),
// se salta su cola: temporizador a 30/60 fps, copia de la pantalla ENTERA a la CPU, reescalado,
// conversión a I420 y envío entre procesos. El retraso queda en 1-2 fotogramas, que es el
// mínimo físico: Windows tiene que haber pintado lo de detrás antes de poder leerlo.
//
// Además el fotograma NO incluye el cursor (va aparte en Desktop Duplication) y la ventana que
// captura no se ve a sí misma si tiene setContentProtection (WDA_EXCLUDEFROMCAPTURE).
//
// Todo son llamadas COM: se leen los punteros de la tabla virtual (vtable) de cada interfaz y
// se llaman con koffi.call. Los índices salen de las cabeceras del SDK de Windows (dxgi.h,
// dxgi1_2.h, d3d11.h), contando los métodos heredados.
//
//   const c = CapturaDXGI.crear({ x, y, w, h })   // px FÍSICOS del escritorio virtual; null si no se puede
//   const f = c.leer()   // null si no hay fotograma nuevo; si no { datos, paso, ancho, alto, edadMs }
//   c.cerrar()
'use strict';

let k = null;     // koffi y todo lo declarado, cargado una vez
function cargar() {
  if (k !== null) return k;
  k = false;
  if (process.platform !== 'win32') return k;
  try {
    const koffi = require('koffi');
    const GUID = koffi.struct('GUID_cdx', { Data1: 'uint32', Data2: 'uint16', Data3: 'uint16', Data4: koffi.array('uint8', 8) });
    const RECT = koffi.struct('RECT_cdx', { left: 'int32', top: 'int32', right: 'int32', bottom: 'int32' });
    const POINT = koffi.struct('POINT_cdx', { x: 'int32', y: 'int32' });
    const OUTPUT_DESC = koffi.struct('DXGI_OUTPUT_DESC_cdx', {
      DeviceName: koffi.array('uint16', 32), DesktopCoordinates: RECT, AttachedToDesktop: 'int32', Rotation: 'int32', Monitor: 'void *',
    });
    const FRAME_INFO = koffi.struct('DXGI_OUTDUPL_FRAME_INFO_cdx', {
      LastPresentTime: 'int64', LastMouseUpdateTime: 'int64', AccumulatedFrames: 'uint32', RectsCoalesced: 'int32',
      ProtectedContentMaskedOut: 'int32', PointerPosition: koffi.struct({ Position: POINT, Visible: 'int32' }),
      TotalMetadataBufferSize: 'uint32', PointerShapeBufferSize: 'uint32',
    });
    const TEX2D_DESC = koffi.struct('D3D11_TEXTURE2D_DESC_cdx', {
      Width: 'uint32', Height: 'uint32', MipLevels: 'uint32', ArraySize: 'uint32', Format: 'uint32',
      SampleDesc: koffi.struct({ Count: 'uint32', Quality: 'uint32' }),
      Usage: 'uint32', BindFlags: 'uint32', CPUAccessFlags: 'uint32', MiscFlags: 'uint32',
    });
    const BOX = koffi.struct('D3D11_BOX_cdx', { left: 'uint32', top: 'uint32', front: 'uint32', right: 'uint32', bottom: 'uint32', back: 'uint32' });
    const MAPPED = koffi.struct('D3D11_MAPPED_SUBRESOURCE_cdx', { pData: 'void *', RowPitch: 'uint32', DepthPitch: 'uint32' });

    const P = (txt) => koffi.proto(txt);
    const proto = {
      QueryInterface: P('int cdx_QI(void *self, GUID_cdx *riid, _Out_ void **out)'),
      Release: P('uint32 cdx_Release(void *self)'),
      EnumAdapters1: P('int cdx_EnumAdapters1(void *self, uint32 i, _Out_ void **adapter)'),
      EnumOutputs: P('int cdx_EnumOutputs(void *self, uint32 i, _Out_ void **output)'),
      OutputGetDesc: P('int cdx_OutputGetDesc(void *self, _Out_ DXGI_OUTPUT_DESC_cdx *desc)'),
      DuplicateOutput: P('int cdx_DuplicateOutput(void *self, void *device, _Out_ void **dupl)'),
      AcquireNextFrame: P('int cdx_AcquireNextFrame(void *self, uint32 timeoutMs, _Out_ DXGI_OUTDUPL_FRAME_INFO_cdx *info, _Out_ void **resource)'),
      ReleaseFrame: P('int cdx_ReleaseFrame(void *self)'),
      CreateTexture2D: P('int cdx_CreateTexture2D(void *self, D3D11_TEXTURE2D_DESC_cdx *desc, void *initial, _Out_ void **tex)'),
      CopySubresourceRegion: P('void cdx_CopySubresourceRegion(void *self, void *dst, uint32 dstSub, uint32 x, uint32 y, uint32 z, void *src, uint32 srcSub, D3D11_BOX_cdx *box)'),
      Map: P('int cdx_Map(void *self, void *res, uint32 sub, int mapType, uint32 flags, _Out_ D3D11_MAPPED_SUBRESOURCE_cdx *mapped)'),
      Unmap: P('void cdx_Unmap(void *self, void *res, uint32 sub)'),
      CreateShaderResourceView: P('int cdx_CreateSRV(void *self, void *res, void *desc, _Out_ void **srv)'),
      GenerateMips: P('void cdx_GenerateMips(void *self, void *srv)'),
    };
    // Índice de cada método en su vtable (heredados incluidos):
    // IUnknown 0-2 · IDXGIObject 3-6 · IDXGIFactory 7-11, IDXGIFactory1 12 EnumAdapters1
    // IDXGIAdapter 7 EnumOutputs · IDXGIOutput 7 GetDesc, IDXGIOutput1 22 DuplicateOutput
    // IDXGIOutputDuplication 8 AcquireNextFrame, 14 ReleaseFrame
    // ID3D11Device 5 CreateTexture2D, 7 CreateShaderResourceView
    // ID3D11DeviceContext 14 Map, 15 Unmap, 46 CopySubresourceRegion, 54 GenerateMips
    const VT = {
      QueryInterface: 0, Release: 2, EnumAdapters1: 12, EnumOutputs: 7, OutputGetDesc: 7, DuplicateOutput: 22,
      AcquireNextFrame: 8, ReleaseFrame: 14, CreateTexture2D: 5, Map: 14, Unmap: 15, CopySubresourceRegion: 46,
      CreateShaderResourceView: 7, GenerateMips: 54,
    };
    const dxgi = koffi.load('dxgi.dll'), d3d11 = koffi.load('d3d11.dll'), k32 = koffi.load('kernel32.dll');
    k = {
      koffi, GUID, proto, VT, OUTPUT_DESC, FRAME_INFO,
      CreateDXGIFactory1: dxgi.func('int CreateDXGIFactory1(GUID_cdx *riid, _Out_ void **factory)'),
      D3D11CreateDevice: d3d11.func('int D3D11CreateDevice(void *adapter, int driverType, void *software, uint32 flags, int *levels, uint32 numLevels, uint32 sdk, _Out_ void **device, _Out_ int *level, _Out_ void **context)'),
      copiar: k32.func('void RtlMoveMemory(void *dst, void *src, size_t n)'),
      QPC: k32.func('int QueryPerformanceCounter(_Out_ int64 *t)'),
      QPF: k32.func('int QueryPerformanceFrequency(_Out_ int64 *f)'),
    };
  } catch (e) {
    console.warn('[captura-dxgi] no disponible:', e && e.message);
  }
  return k;
}

function guid(txt) {
  const h = txt.replace(/[{}-]/g, '');
  const b = [];
  for (let i = 16; i < 32; i += 2) b.push(parseInt(h.slice(i, i + 2), 16));
  return { Data1: parseInt(h.slice(0, 8), 16), Data2: parseInt(h.slice(8, 12), 16), Data3: parseInt(h.slice(12, 16), 16), Data4: b };
}
const IID = {
  IDXGIFactory1: guid('770aae78-f26f-4dba-a829-253c83d1b387'),
  IDXGIOutput1: guid('00cddea8-939b-4b83-a340-a685226666cc'),
  ID3D11Texture2D: guid('6f15aaf2-d208-4e89-9ab4-489535d34f9c'),
};
const HR = { WAIT_TIMEOUT: 0x887A0027 | 0, ACCESS_LOST: 0x887A0026 | 0 };

// Llama al método `nombre` del objeto COM `obj`.
function com(obj, nombre, ...args) {
  const { koffi, proto, VT } = k;
  const vtabla = koffi.decode(obj, 'void *');
  const fn = koffi.decode(vtabla, VT[nombre] * 8, 'void *');
  return koffi.call(fn, proto[nombre], obj, ...args);
}
function soltar(obj) { if (obj) { try { com(obj, 'Release'); } catch {} } }

class CapturaDXGI {
  static disponible() { return !!cargar(); }

  // rect: { x, y, w, h } en px físicos del escritorio virtual.
  // opciones.mitad: la GPU la reduce a la mitad antes de leerla (un mipmap): 4 veces menos que
  // copiar y subir, y el cristal solo usa el fondo ya desenfocado, así que no se nota.
  static crear(rect, opciones) {
    if (!cargar()) return null;
    const c = new CapturaDXGI();
    c.mitad = !!(opciones && opciones.mitad);
    try { if (c._abrir(rect)) return c; } catch (e) { console.warn('[captura-dxgi]', e && e.message); }
    c.cerrar();
    return null;
  }

  _abrir(rect) {
    const centroX = rect.x + rect.w / 2, centroY = rect.y + rect.h / 2;
    const f = [null];
    if (k.CreateDXGIFactory1(IID.IDXGIFactory1, f) < 0 || !f[0]) return false;
    this.factoria = f[0];
    // La salida (monitor) donde cae la zona, y la tarjeta gráfica que la pinta: el dispositivo
    // D3D tiene que ser de esa misma tarjeta (con gráfica híbrida, si no, DuplicateOutput falla).
    for (let a = 0; !this.salida; a++) {
      const ad = [null];
      if (com(this.factoria, 'EnumAdapters1', a, ad) < 0 || !ad[0]) break;
      for (let o = 0; ; o++) {
        const sa = [null];
        if (com(ad[0], 'EnumOutputs', o, sa) < 0 || !sa[0]) break;
        const desc = {};
        com(sa[0], 'OutputGetDesc', desc);
        const r = desc.DesktopCoordinates;
        if (desc.AttachedToDesktop && centroX >= r.left && centroX < r.right && centroY >= r.top && centroY < r.bottom) {
          this.adaptador = ad[0]; this.salida = sa[0]; this.desc = desc;
          break;
        }
        soltar(sa[0]);
      }
      if (!this.salida) soltar(ad[0]);
    }
    if (!this.salida) return false;
    const dev = [null], ctx = [null], nivel = [0];
    // D3D_DRIVER_TYPE_UNKNOWN (0) con adaptador explícito; D3D11_SDK_VERSION = 7.
    if (k.D3D11CreateDevice(this.adaptador, 0, null, 0, null, 0, 7, dev, nivel, ctx) < 0 || !dev[0]) return false;
    this.dispositivo = dev[0]; this.contexto = ctx[0];
    const s1 = [null];
    if (com(this.salida, 'QueryInterface', IID.IDXGIOutput1, s1) < 0 || !s1[0]) return false;
    this.salida1 = s1[0];
    if (!this._duplicar()) return false;
    this.mover(rect);
    const fr = [0n];
    k.QPF(fr);
    this.frecuencia = Number(fr[0]) || 1e7;
    return true;
  }

  _duplicar() {
    soltar(this.duplicacion); this.duplicacion = null;
    const d = [null];
    const hr = com(this.salida1, 'DuplicateOutput', this.dispositivo, d);
    if (hr < 0 || !d[0]) { this.error = hr >>> 0; return false; }
    this.duplicacion = d[0];
    return true;
  }

  // Cambia la zona (si se mueve o cambia de tamaño la ventana).
  mover(rect) {
    const r = this.desc.DesktopCoordinates;
    const x0 = Math.max(r.left, Math.floor(rect.x)), y0 = Math.max(r.top, Math.floor(rect.y));
    const x1 = Math.min(r.right, Math.ceil(rect.x + rect.w)), y1 = Math.min(r.bottom, Math.ceil(rect.y + rect.h));
    const w = Math.max(1, x1 - x0), h = Math.max(1, y1 - y0);
    this.caja = { left: x0 - r.left, top: y0 - r.top, front: 0, right: x0 - r.left + w, bottom: y0 - r.top + h, back: 1 };
    this.zona = { x: x0, y: y0, w, h };   // lo que de verdad se captura (recortado a la pantalla)
    if (this.staging && this.zonaW === w && this.zonaH === h) return;
    this.zonaW = w; this.zonaH = h;
    for (const n of ['staging', 'reductor', 'reductorVista']) { soltar(this[n]); this[n] = null; }
    const tex = (desc) => {
      const t = [null];
      const base = { MipLevels: 1, ArraySize: 1, Format: 87 /* B8G8R8A8_UNORM */, SampleDesc: { Count: 1, Quality: 0 },
        Usage: 0, BindFlags: 0, CPUAccessFlags: 0, MiscFlags: 0 };
      if (com(this.dispositivo, 'CreateTexture2D', { ...base, ...desc }, null, t) < 0 || !t[0]) return null;
      return t[0];
    };
    let ancho = w, alto = h;
    if (this.mitad && w >= 4 && h >= 4) {
      // Textura con 2 niveles (la zona y su mitad) que la GPU sabe reducir sola (GenerateMips).
      const r = tex({ Width: w, Height: h, MipLevels: 2, BindFlags: 0x28 /* RENDER_TARGET | SHADER_RESOURCE */, MiscFlags: 1 /* GENERATE_MIPS */ });
      const v = [null];
      if (r && com(this.dispositivo, 'CreateShaderResourceView', r, null, v) >= 0 && v[0]) {
        this.reductor = r; this.reductorVista = v[0];
        ancho = Math.max(1, w >> 1); alto = Math.max(1, h >> 1);
      } else soltar(r);   // sin reducir: se copia a tamaño completo
    }
    const st = tex({ Width: ancho, Height: alto, Usage: 3 /* STAGING */, CPUAccessFlags: 0x20000 /* READ */ });
    if (!st) throw new Error('CreateTexture2D');
    this.staging = st; this.ancho = ancho; this.alto = alto;
    this.datos = null;
  }

  // El último fotograma, si hay uno nuevo desde la vez anterior.
  leer() {
    if (!this.duplicacion && !this._duplicar()) return null;
    const info = {}, rec = [null];
    const hr = com(this.duplicacion, 'AcquireNextFrame', 0, info, rec);
    if (hr === HR.WAIT_TIMEOUT) return null;
    if (hr === HR.ACCESS_LOST) { this._duplicar(); return null; }   // UAC, cambio de resolución, pantalla completa...
    if (hr < 0 || !rec[0]) return null;
    let resultado = null;
    try {
      // Solo interesa si cambió la imagen (no si solo se movió el ratón).
      if (info.LastPresentTime && BigInt(info.LastPresentTime) !== 0n) {
        const tex = [null];
        if (com(rec[0], 'QueryInterface', IID.ID3D11Texture2D, tex) >= 0 && tex[0]) {
          if (this.reductor) {
            // La zona a la textura de 2 niveles, la GPU genera la mitad, y esa mitad a la de lectura.
            com(this.contexto, 'CopySubresourceRegion', this.reductor, 0, 0, 0, 0, tex[0], 0, this.caja);
            com(this.contexto, 'GenerateMips', this.reductorVista);
            com(this.contexto, 'CopySubresourceRegion', this.staging, 0, 0, 0, 0, this.reductor, 1, null);
          } else {
            com(this.contexto, 'CopySubresourceRegion', this.staging, 0, 0, 0, 0, tex[0], 0, this.caja);
          }
          soltar(tex[0]);
          resultado = true;
        }
      }
    } finally {
      soltar(rec[0]);
      com(this.duplicacion, 'ReleaseFrame');
    }
    if (!resultado) return null;
    const m = {};
    if (com(this.contexto, 'Map', this.staging, 0, 1 /* D3D11_MAP_READ */, 0, m) < 0 || !m.pData) return null;
    try {
      const n = m.RowPitch * this.alto;
      if (!this.datos || this.datos.length !== n) this.datos = new Uint8Array(n);
      k.copiar(this.datos, m.pData, n);
      const ahora = [0n];
      k.QPC(ahora);
      return {
        datos: this.datos, paso: m.RowPitch, ancho: this.ancho, alto: this.alto,
        edadMs: Number(BigInt(ahora[0]) - BigInt(info.LastPresentTime)) * 1000 / this.frecuencia,
      };
    } finally {
      com(this.contexto, 'Unmap', this.staging, 0);
    }
  }

  cerrar() {
    for (const n of ['staging', 'reductorVista', 'reductor', 'duplicacion', 'salida1', 'contexto', 'dispositivo', 'salida', 'adaptador', 'factoria']) {
      soltar(this[n]); this[n] = null;
    }
  }
}

module.exports = { CapturaDXGI };
