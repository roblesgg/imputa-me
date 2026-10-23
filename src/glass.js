/**
 * Cristal líquido para bocadillos y menús (2.8).
 *
 * Sombreadores portados de Liquid Glass Studio — https://github.com/iyinchao/liquid-glass-studio
 * (MIT, © iyinchao): paso final de su sombreador principal (STEP 9), con su desenfoque gaussiano
 * en dos pasadas. Valores elegidos por Álvaro en la sesión de diseño (ver
 * docs/superpowers/plans/2026-10-21-rediseno-mac.md).
 *
 * Cómo funciona: antes de enseñar el bocadillo se pide al proceso principal una foto de la
 * ventana (capturePage, en crudo) y se desenfoca UNA vez en la tarjeta gráfica. El cristal
 * se pinta en un <canvas> pegado al bocadillo que dobla esa foto por los cantos; fuera de la
 * forma solo hay sombra. Como la foto es de la ventana entera, si el bocadillo crece o se
 * mueve no hace falta otra foto (que además ya saldría con el propio bocadillo dentro).
 * Sin WebGL2 (o con renderizado por software) no se hace nada y el bocadillo se queda con su
 * esmerilado de CSS.
 *
 * Uso:
 *   const g = await LiquidGlass.attach(el, { tail: { x, y }, roundness, radius });  // null si no hay
 *   g.entrar() · await g.salir() · g.reflow() · g.detach()
 */
(function (global) {
  'use strict';

  const CFG = {
    refDistance: 0.11,
    refThickness: 29,
    refFactor: 1.62,
    blur: 30.5,              // en px CSS
    fresRange: 30,
    fresHard: 0,
    fresFactor: 0.34,
    glareRange: 30,
    glareHard: 0.2,
    glareFactor: 0,
    glareConvergence: 0.5,
    glareOpposite: 0.8,
    glareAngle: -40,
    roundness: 5,            // superelipse de las esquinas (5 = la de Apple)
    margin: 44,              // px alrededor de la forma para la sombra
    shadow: { expand: 26, factor: 0.42, x: 0, y: 12 },
  };

  // ── Sombreadores (GLSL ES 3.00) ─────────────────────────────────────────────
  const UNIFORMES = `
uniform vec2 u_resolution;
uniform float u_dpr;
uniform vec2 u_shapeCenter;
uniform vec2 u_tailCenter;
uniform float u_tailRadius;
uniform float u_mergeRate;
uniform float u_shapeWidth;
uniform float u_shapeHeight;
uniform float u_shapeRadius;
uniform float u_shapeRoundness;
uniform int u_showShape1;`;

  const SDF = `
float sdCircle(vec2 p, float r) { return length(p) - r; }
float superellipseCornerSDF(vec2 p, float r, float n) {
  p = abs(p);
  float v = pow(pow(p.x, n) + pow(p.y, n), 1.0 / n);
  return v - r;
}
float roundedRectSDF(vec2 p, vec2 center, float width, float height, float cornerRadius, float n) {
  p -= center;
  float cr = cornerRadius * u_dpr;
  vec2 d = abs(p) - vec2(width * u_dpr, height * u_dpr) * 0.5;
  float dist;
  if (d.x > -cr && d.y > -cr) {
    vec2 cornerCenter = sign(p) * (vec2(width * u_dpr, height * u_dpr) * 0.5 - vec2(cr));
    vec2 cornerP = p - cornerCenter;
    dist = superellipseCornerSDF(cornerP, cr, n);
  } else {
    dist = min(max(d.x, d.y), 0.0) + length(max(d, 0.0));
  }
  return dist;
}
float smin(float a, float b, float k) {
  float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}
// p1: centro de la gotita (la punta del bocadillo); p2: centro del bocadillo.
float mainSDF(vec2 p1, vec2 p2, vec2 p) {
  vec2 p1n = p1 + p / u_resolution.y;
  vec2 p2n = p2 + p / u_resolution.y;
  float d1 = u_showShape1 == 1 ? sdCircle(p1n, u_tailRadius * u_dpr / u_resolution.y) : 1.0;
  float d2 = roundedRectSDF(p2n, vec2(0.0), u_shapeWidth / u_resolution.y, u_shapeHeight / u_resolution.y,
                            u_shapeRadius / u_resolution.y, u_shapeRoundness);
  return smin(d1, d2, u_mergeRate);
}`;

  const VS = `#version 300 es
in vec4 a_position;
out vec2 v_uv;
void main() { v_uv = (a_position.xy + 1.0) * 0.5; gl_Position = a_position; }`;

  // Fondo: la foto llega en BGRA con el alfa premultiplicado (así la da Windows). Se pasa a
  // RGB y lo transparente (detrás está el acrílico del sistema) se rellena con el tinte.
  const FS_BG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_bgTexture;
uniform vec4 u_recorte;   // xy: origen, zw: tamaño (en UV de la foto); la zona que se desenfoca
uniform vec3 u_fondo;
uniform int u_bgra;   // 0: RGBA (vídeo) · 1: BGRA (toBitmap) · 2: BGRA de la captura nativa (opaca)
void main() {
  vec4 c = texture(u_bgTexture, u_recorte.xy + v_uv * u_recorte.zw);
  if (u_bgra >= 1) c = c.bgra;
  if (u_bgra == 2) c.a = 1.0;
  fragColor = vec4(c.rgb + (1.0 - c.a) * u_fondo, 1.0);
}`;

  function FS_BLUR(vertical) {
    return `#version 300 es
precision highp float;
#define MAX_BLUR_RADIUS (64)
in vec2 v_uv;
uniform sampler2D u_prevPassTexture;
uniform vec2 u_resolution;
uniform int u_blurRadius;
uniform float u_blurWeights[MAX_BLUR_RADIUS + 1];
out vec4 fragColor;
void main() {
  vec2 texelSize = 1.0 / u_resolution;
  vec4 color = texture(u_prevPassTexture, v_uv) * u_blurWeights[0];
  for (int i = 1; i <= MAX_BLUR_RADIUS; ++i) {
    if (i > u_blurRadius) break;
    float w = u_blurWeights[i];
    vec2 offset = vec2(float(i)) * texelSize;
    ${vertical
      ? 'color += texture(u_prevPassTexture, v_uv + vec2(0.0, offset.y)) * w;\n    color += texture(u_prevPassTexture, v_uv - vec2(0.0, offset.y)) * w;'
      : 'color += texture(u_prevPassTexture, v_uv + vec2(offset.x, 0.0)) * w;\n    color += texture(u_prevPassTexture, v_uv - vec2(offset.x, 0.0)) * w;'}
  }
  fragColor = color;
}`;
  }

  const COLOR = `
const vec3 D65_WHITE = vec3(0.95045592705, 1.0, 1.08905775076);
vec3 WHITE = D65_WHITE;
const mat3 RGB_TO_XYZ_M = mat3(0.4124, 0.3576, 0.1805, 0.2126, 0.7152, 0.0722, 0.0193, 0.1192, 0.9505);
const mat3 XYZ_TO_RGB_M = mat3(3.2406255, -1.537208, -0.4986286, -0.9689307, 1.8757561, 0.0415175, 0.0557101, -0.2040211, 1.0569959);
float UNCOMPAND_SRGB(float a) { return a > 0.04045 ? pow((a + 0.055) / 1.055, 2.4) : a / 12.92; }
float COMPAND_RGB(float a) { return a <= 0.0031308 ? 12.92 * a : 1.055 * pow(a, 0.41666666666) - 0.055; }
vec3 SRGB_TO_LCH_(vec3 srgb) {
  vec3 rgb = vec3(UNCOMPAND_SRGB(srgb.x), UNCOMPAND_SRGB(srgb.y), UNCOMPAND_SRGB(srgb.z));
  vec3 xyz = rgb * RGB_TO_XYZ_M;
  vec3 s = xyz / WHITE;
  s = vec3(s.x > 0.00885645167 ? pow(s.x, 0.333333333) : 7.78703703704 * s.x + 0.13793103448,
           s.y > 0.00885645167 ? pow(s.y, 0.333333333) : 7.78703703704 * s.y + 0.13793103448,
           s.z > 0.00885645167 ? pow(s.z, 0.333333333) : 7.78703703704 * s.z + 0.13793103448);
  vec3 lab = vec3(116.0 * s.y - 16.0, 500.0 * (s.x - s.y), 200.0 * (s.y - s.z));
  return vec3(lab.x, sqrt(dot(lab.yz, lab.yz)), atan(lab.z, lab.y) * 57.2957795131);
}
float LAB_TO_XYZ_F(float x) { return x > 0.206897 ? x * x * x : 0.12841854934 * (x - 0.137931034); }
vec3 LCH_TO_SRGB_(vec3 lch) {
  vec3 lab = vec3(lch.x, lch.y * cos(lch.z * 0.01745329251), lch.y * sin(lch.z * 0.01745329251));
  float w = (lab.x + 16.0) / 116.0;
  vec3 xyz = WHITE * vec3(LAB_TO_XYZ_F(w + lab.y / 500.0), LAB_TO_XYZ_F(w), LAB_TO_XYZ_F(w - lab.z / 200.0));
  vec3 rgb = xyz * XYZ_TO_RGB_M;
  return vec3(COMPAND_RGB(rgb.x), COMPAND_RGB(rgb.y), COMPAND_RGB(rgb.z));
}`;

  // Paso principal (STEP 9 del original). Cambios: el fondo se lee de la foto de la ventana
  // (mapUV pasa de coordenadas del lienzo a las de la foto), sin dispersión de color, y
  // fuera de la forma se pinta la sombra con transparencia en vez del fondo.
  const FS_MAIN = `#version 300 es
precision highp float;
#define PI (3.14159265359)
in vec2 v_uv;
uniform sampler2D u_blurredBg;
${UNIFORMES}
uniform vec2 u_uvOrigin;
uniform vec2 u_uvScale;
uniform vec4 u_tint;
uniform float u_refThickness;
uniform float u_refDistance;
uniform float u_refFactor;
uniform float u_refFresnelRange;
uniform float u_refFresnelFactor;
uniform float u_refFresnelHardness;
uniform float u_glareRange;
uniform float u_glareConvergence;
uniform float u_glareOppositeFactor;
uniform float u_glareFactor;
uniform float u_glareHardness;
uniform float u_glareAngle;
uniform float u_shadowExpand;
uniform float u_shadowFactor;
uniform vec2 u_shadowOffset;
uniform float u_shadowMax;
uniform float u_opacity;
out vec4 fragColor;
${SDF}
vec2 mapUV(vec2 uv) { return u_uvOrigin + uv * u_uvScale; }
float safeAsin(float x) { return asin(clamp(x, -1.0, 1.0)); }
vec2 getNormal(vec2 p1, vec2 p2, vec2 p) {
  vec2 h = vec2(max(abs(dFdx(p.x)), 0.0001), max(abs(dFdy(p.y)), 0.0001));
  vec2 grad = vec2(mainSDF(p1, p2, p + vec2(h.x, 0.0)) - mainSDF(p1, p2, p - vec2(h.x, 0.0)),
                   mainSDF(p1, p2, p + vec2(0.0, h.y)) - mainSDF(p1, p2, p - vec2(0.0, h.y))) / (2.0 * h);
  // El original devuelve grad * 1414: su intensidad depende de la altura del lienzo (pensado
  // para ~1200 px). Se normaliza a esa escala para que no se dispare en lienzos pequeños.
  return grad * u_resolution.y * 1.18;
}
${COLOR}
float vec2ToAngle(vec2 v) { float angle = atan(v.y, v.x); if (angle < 0.0) angle += 2.0 * PI; return angle; }
void main() {
  vec2 u_resolution1x = u_resolution.xy / u_dpr;
  vec2 p1 = (vec2(0.0) - u_tailCenter) / u_resolution.y;
  vec2 p2 = (vec2(0.0) - u_shapeCenter) / u_resolution.y;
  float merged = mainSDF(p1, p2, gl_FragCoord.xy);
  vec4 outColor = vec4(0.0);
  vec3 tint = u_tint.rgb;
  if (merged < 0.005) {
    float nmerged = -1.0 * (merged * u_resolution1x.y);
    float x_R_ratio = 1.0 - nmerged / u_refThickness;
    float thetaI = safeAsin(pow(x_R_ratio, 2.0));
    float thetaT = safeAsin(1.0 / u_refFactor * sin(thetaI));
    float edgeFactor = -1.0 * tan(thetaT - thetaI);
    if (nmerged >= u_refThickness) { edgeFactor = 0.0; }
    if (edgeFactor <= 0.0) {
      outColor = texture(u_blurredBg, mapUV(v_uv));
      outColor = mix(outColor, vec4(tint, 1.0), u_tint.a * 0.8);
    } else {
      vec2 normal = getNormal(p1, p2, gl_FragCoord.xy);
      vec2 offset = -normal * edgeFactor * u_refDistance * u_dpr * vec2(u_resolution.y / (u_resolution1x.x * u_dpr), 1.0);
      vec4 blurredPixel = texture(u_blurredBg, mapUV(v_uv + offset));
      outColor = mix(blurredPixel, vec4(tint, 1.0), u_tint.a * 0.8);
      float fresnelFactor = clamp(pow(1.0 + merged * u_resolution1x.y / 1500.0 * pow(500.0 / u_refFresnelRange, 2.0) + u_refFresnelHardness, 5.0), 0.0, 1.0);
      vec3 fresnelTintLCH = SRGB_TO_LCH_(mix(vec3(1.0), tint, u_tint.a * 0.5));
      fresnelTintLCH.x += 20.0 * fresnelFactor * u_refFresnelFactor;
      fresnelTintLCH.x = clamp(fresnelTintLCH.x, 0.0, 100.0);
      outColor = mix(outColor, vec4(LCH_TO_SRGB_(fresnelTintLCH), 1.0), fresnelFactor * u_refFresnelFactor * 0.7 * length(normal));
      float glareGeoFactor = clamp(pow(1.0 + merged * u_resolution1x.y / 1500.0 * pow(500.0 / u_glareRange, 2.0) + u_glareHardness, 5.0), 0.0, 1.0);
      float glareAngle = (vec2ToAngle(normalize(normal)) - PI / 4.0 + u_glareAngle) * 2.0;
      int glareFarside = 0;
      if (glareAngle > PI * (2.0 - 0.5) && glareAngle < PI * (4.0 - 0.5) || glareAngle < PI * (0.0 - 0.5)) { glareFarside = 1; }
      float glareAngleFactor = (0.5 + sin(glareAngle) * 0.5) * (glareFarside == 1 ? 1.2 * u_glareOppositeFactor : 1.2) * u_glareFactor;
      glareAngleFactor = clamp(pow(glareAngleFactor, 0.1 + u_glareConvergence * 2.0), 0.0, 1.0);
      vec3 glareTintLCH = SRGB_TO_LCH_(mix(blurredPixel.rgb, tint, u_tint.a * 0.5));
      glareTintLCH.x += 150.0 * glareAngleFactor * glareGeoFactor;
      glareTintLCH.y += 30.0 * glareAngleFactor * glareGeoFactor;
      glareTintLCH.x = clamp(glareTintLCH.x, 0.0, 120.0);
      outColor = mix(outColor, vec4(LCH_TO_SRGB_(glareTintLCH), 1.0), glareAngleFactor * glareGeoFactor * length(normal));
    }
  }
  // Fuera de la forma: solo la sombra (la del original, desplazada y sin el fondo detrás).
  vec2 p2s = (vec2(0.0) - u_shapeCenter - u_shadowOffset * u_dpr) / u_resolution.y;
  vec2 p1s = (vec2(0.0) - u_tailCenter - u_shadowOffset * u_dpr) / u_resolution.y;
  float ms = mainSDF(p1s, p2s, gl_FragCoord.xy);
  float dSombra = max(ms, 0.0) * u_resolution1x.y;
  // Se apaga del todo antes del borde del lienzo: si no, quedaba un rectángulo marcado.
  float apagado = clamp(1.0 - dSombra / u_shadowMax, 0.0, 1.0);
  float shadow = exp(-1.0 / u_shadowExpand * dSombra) * 0.6 * u_shadowFactor * apagado * apagado;
  float inside = 1.0 - smoothstep(-0.001, 0.001, merged);
  vec4 sombra = vec4(0.0, 0.0, 0.0, ms > 0.0 ? shadow : 0.6 * u_shadowFactor);
  vec4 c = mix(sombra, vec4(outColor.rgb, 1.0), inside);
  // Alfa PREMULTIPLICADO (el lienzo se crea así, que es lo que espera el compositor): con alfa
  // sin premultiplicar, en Windows con ventanas transparentes se veía a veces un rectángulo
  // blanco donde el alfa es 0 (al desvanecerse un bocadillo).
  float a = c.a * u_opacity;
  fragColor = vec4(c.rgb * a, a);
}`;

  // ── Utilidades ──────────────────────────────────────────────────────────────
  function kernelGauss(radius) {   // computeGaussianKernelByRadius del original, admitiendo decimales
    const n = Math.max(1, Math.min(64, Math.ceil(radius)));
    const sigma = Math.max(0.5, radius / 3.0);
    const k = []; let sum = 0;
    for (let i = 0; i <= n; i++) { const w = Math.exp(-0.5 * (i * i) / (sigma * sigma)); k.push(w); sum += i === 0 ? w : w * 2; }
    const pesos = new Float32Array(65);
    k.forEach((w, i) => { pesos[i] = w / sum; });
    return { n, pesos };
  }

  // Ojo: no se mira prefers-reduced-transparency. En Windows sale activo con solo apagar los
  // "efectos de transparencia" del sistema, y el cristal se eligió a propósito; quien no lo
  // quiera lo apaga en Ajustes (data-glass="off", ver applyThemeVars en shared.js).
  let soporte = null;
  function supported() {
    if (global.LIQUID_GLASS_FORCE) return true;
    if (document.documentElement.dataset.glass === 'off') return false;
    if (soporte !== null) return soporte;
    soporte = false;
    try {
      const c = document.createElement('canvas');
      const gl = c.getContext('webgl2');
      if (!gl) return soporte;
      const dbg = gl.getExtension('WEBGL_debug_renderer_info');
      const r = dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : '';
      // Sin tarjeta gráfica el desenfoque de 30 px por software se nota: mejor el esmerilado.
      soporte = !/swiftshader|software|llvmpipe/i.test(r);
      const lose = gl.getExtension('WEBGL_lose_context'); if (lose) lose.loseContext();
    } catch { soporte = false; }
    return soporte;
  }

  function colorCss(valor, defecto) {
    const c = document.createElement('canvas').getContext('2d');
    c.fillStyle = defecto; c.fillStyle = valor || defecto;
    const hex = c.fillStyle;   // '#rrggbb' (o rgba(...) si lleva alfa)
    const m = /^#([0-9a-f]{6})$/i.exec(hex);
    if (m) { const n = parseInt(m[1], 16); return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]; }
    const r = /rgba?\(([^)]+)\)/.exec(hex);
    if (r) { const p = r[1].split(',').map(Number); return [p[0] / 255, p[1] / 255, p[2] / 255]; }
    return [0.12, 0.1, 0.11];
  }

  let temaCache = null;
  if (typeof window !== 'undefined' && window.addEventListener) window.addEventListener('theme-change', () => { temaCache = null; });
  function leerTema() {
    if (temaCache) return temaCache;
    temaCache = leerTemaAhora();
    return temaCache;
  }
  function leerTemaAhora() {
    const cs = getComputedStyle(document.documentElement);
    const rgb = (cs.getPropertyValue('--glass-rgb') || '30,26,30').split(',').map(n => Number(n) / 255);
    const a = Number(cs.getPropertyValue('--glass-tint')) || 0.25;
    const claro = document.documentElement.dataset.scheme === 'light';
    return { tint: [rgb[0] || 0, rgb[1] || 0, rgb[2] || 0, a], claro, fondo: colorCss(cs.getPropertyValue('--surface').trim(), '#1f1a1d') };
  }

  // Foto de la ventana entera (en crudo) y dónde cae esta página dentro de ella.
  async function capturarVentana() {
    let ipc = null;
    try { ipc = require('electron').ipcRenderer; } catch { return null; }
    const r = await ipc.invoke('capture-region', {});
    if (!r || !r.data || !r.pw || !r.ph || !r.iw) return null;
    return r;
  }

  // Foto de lo que hay DETRÁS de la ventana en la pantalla (el escritorio y las demás
  // apps), con la zona que cubre en coordenadas de pantalla. Para el panel lateral.
  async function capturarEscritorio() {
    let ipc = null;
    try { ipc = require('electron').ipcRenderer; } catch { return null; }
    const r = await ipc.invoke('capture-desktop', {});
    if (!r || !r.data || !r.pw || !r.ph || !r.region || !r.region.w) return null;
    return r;
  }

  // ── El cristal de un elemento ───────────────────────────────────────────────
  // La esquina de superelipse (n = 5) recorta menos que un círculo del mismo radio: para que
  // el cristal case con el border-radius del elemento hace falta un radio ~2,3 veces mayor.
  const SUPERELIPSE_POR_CSS = 1 / 0.44;

  class Glass {
    constructor(host, opts) {
      this.host = host;
      const css = parseFloat(getComputedStyle(host).borderTopLeftRadius) || 26;
      // Opciones: fuente 'ventana' (la propia app, por defecto) o 'escritorio' (lo que hay
      // detrás de la ventana); foto: una foto ya pedida (promesa); margen: px de lienzo
      // alrededor (para la sombra); sombra: false para no pintarla; extiende: {left,right,
      // top,bottom} px que la forma sigue más allá del elemento (para que un lado pegado a
      // un borde no se redondee); dpr: resolución del lienzo; sinMarca: no poner .lg-on
      // (quien lo usa decide cuándo quitar su fondo); tinte: cuánto tiñe (0-1), si no el
      // del tema.
      this.opts = Object.assign({ radius: css * SUPERELIPSE_POR_CSS, roundness: CFG.roundness, tail: null, tailRadius: 11, scale: 1,
        fuente: 'ventana', foto: null, margen: null, sombra: true, extiende: null, dpr: null, sinMarca: false, tinte: null, desenfoque: null, vivo: null, nativo: null }, opts || {});
      this.dpr = this.opts.dpr || Math.min(2, window.devicePixelRatio || 1);
      this.canvas = document.createElement('canvas');
      this.canvas.className = 'lg-canvas';
      this.opacity = 1;
    }

    _programa(fs) {
      const gl = this.gl;
      const compilar = (tipo, src) => {
        const sh = gl.createShader(tipo); gl.shaderSource(sh, src); gl.compileShader(sh);
        if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh));
        return sh;
      };
      const p = gl.createProgram();
      gl.attachShader(p, compilar(gl.VERTEX_SHADER, VS));
      gl.attachShader(p, compilar(gl.FRAGMENT_SHADER, fs));
      gl.bindAttribLocation(p, 0, 'a_position');
      gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
      p.locs = {};
      return p;
    }

    _u(p, nombre, v) {
      const gl = this.gl;
      if (!(nombre in p.locs)) p.locs[nombre] = gl.getUniformLocation(p, nombre);
      const loc = p.locs[nombre];
      if (loc === null) return;
      if (typeof v === 'number') gl.uniform1f(loc, v);
      else if (v && v.i !== undefined) gl.uniform1i(loc, v.i);
      else if (v.length === 2) gl.uniform2f(loc, v[0], v[1]);
      else if (v.length === 3) gl.uniform3f(loc, v[0], v[1], v[2]);
      else if (v.length === 4) gl.uniform4f(loc, v[0], v[1], v[2], v[3]);
      else gl.uniform1fv(loc, v);
    }

    _textura(w, h, datos) {
      const gl = this.gl;
      const t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, datos || null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      return t;
    }

    _destino(w, h) {
      const gl = this.gl;
      const tex = this._textura(w, h, null);
      const fb = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      return { tex, fb };
    }

    // Coloca el lienzo: el rectángulo del elemento más un margen para la sombra y la gotita.
    _medir() {
      // Tamaño de maquetación (no le afectan las animaciones con transform) y posición real.
      const r = this.host.getBoundingClientRect();
      const w = this.host.offsetWidth || r.width, h = this.host.offsetHeight || r.height;
      const t = this.opts.tail;
      let m = this.opts.margen != null ? this.opts.margen : CFG.margin;
      if (t) {   // que la gotita quepa entera aunque asome más que el margen
        const fuera = Math.max(-t.x, t.x - w, -t.y, t.y - h, 0);
        m = Math.max(m, Math.ceil(fuera + this.opts.tailRadius + 10));
      }
      this.caja = { left: r.left - m, top: r.top - m, width: w + m * 2, height: h + m * 2 };
      this.forma = { w, h };
      this.margen = m;
      Object.assign(this.canvas.style, { left: -m + 'px', top: -m + 'px', width: this.caja.width + 'px', height: this.caja.height + 'px' });
      const W = Math.round(this.caja.width * this.dpr), H = Math.round(this.caja.height * this.dpr);
      if (this.canvas.width !== W) this.canvas.width = W;
      if (this.canvas.height !== H) this.canvas.height = H;
    }

    async init() {
      this._medir();
      // vivo: { video, region } — la pantalla en directo (ver pantallaEnVivo): el cristal se
      // rehace con cada fotograma, en vez de quedarse con una foto fija.
      // nativo: la captura DXGI de la zona de detrás (ver pantallaNativa): lo más rápido.
      const nat = this.opts.nativo && this.opts.nativo.captura ? this.opts.nativo : null;
      const vivo = !nat && this.opts.vivo && this.opts.vivo.video && this.opts.vivo.video.videoWidth ? this.opts.vivo : null;
      const foto = nat ? { pw: nat.captura.ancho, ph: nat.captura.alto, region: nat.regionDIP() }
        : vivo ? { pw: vivo.video.videoWidth, ph: vivo.video.videoHeight, region: vivo.region }
        : this.opts.foto ? await this.opts.foto
        : (this.opts.fuente === 'escritorio' ? await capturarEscritorio() : await capturarVentana());
      if (!foto || !this.host.isConnected) return false;
      const gl = this.canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: false });
      // Si la GPU pierde el contexto (reinicio del driver, demasiados contextos), el lienzo no
      // puede quedarse pintado sin contenido: se esconde y queda el esmerilado de CSS.
      this.canvas.addEventListener('webglcontextlost', () => {
        this.canvas.style.display = 'none';
        this.host.classList.remove('lg-on');
      });
      if (!gl) return false;
      this.gl = gl;
      try {
        this.pBg = this._programa(FS_BG);
        this.pBlurX = this._programa(FS_BLUR(false));
        this.pBlurY = this._programa(FS_BLUR(true));
        this.pMain = this._programa(FS_MAIN);
      } catch (e) {
        console.warn('[glass] sin cristal líquido:', e && e.message);
        return false;
      }
      this.vao = gl.createVertexArray(); gl.bindVertexArray(this.vao);
      const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

      // Dónde cae la página dentro de la foto (px CSS → px de la foto). Con una foto de la
      // pantalla (region), el desplazamiento se calcula al pintar con la posición de la
      // ventana, que puede cambiar de tamaño.
      this.foto = foto.region
        ? { pw: foto.pw, ph: foto.ph, k: foto.pw / foto.region.w, region: foto.region }
        : { pw: foto.pw, ph: foto.ph, k: foto.pw / foto.iw, offX: foto.offX || 0, offY: foto.offY || 0 };

      // Fondo a media resolución (con 30 px de desenfoque no se nota y cuesta 4 veces menos). La
      // captura nativa ya llega a la mitad (la reduce la GPU): esa se desenfoca tal cual.
      this.recorte = vivo ? this._recorteVentana() : { x: 0, y: 0, w: foto.pw, h: foto.ph };
      this.escalaFbo = nat ? 1 : 0.5;
      this.W0 = Math.max(1, Math.ceil(this.recorte.w * this.escalaFbo)); this.H0 = Math.max(1, Math.ceil(this.recorte.h * this.escalaFbo));
      this.fuente = (vivo || nat) ? this._textura(foto.pw, foto.ph, null)
        : this._textura(foto.pw, foto.ph, foto.data instanceof Uint8Array ? foto.data : new Uint8Array(foto.data));
      this.f0 = this._destino(this.W0, this.H0); this.f1 = this._destino(this.W0, this.H0);
      this.f2 = this._destino(this.W0, this.H0);
      if (vivo) this._subirVideo(vivo.video);
      if (nat && nat.captura._primero) { this._subirNativo(nat.captura._primero); nat.captura._primero = null; }
      this._hornear(nat ? 2 : !vivo);
      if (vivo) this._seguirVivo(vivo.video);
      else if (nat) this._seguirNativo(nat);
      if (!vivo && !nat) {   // con foto fija, lo intermedio ya no hace falta: solo se queda el fondo desenfocado
        gl.deleteTexture(this.fuente); this.fuente = null;
        [this.f0, this.f1].forEach((f) => { gl.deleteFramebuffer(f.fb); gl.deleteTexture(f.tex); });
        this.f0 = this.f1 = null;
      }

      this.host.insertBefore(this.canvas, this.host.firstChild);
      if (!this.opts.sinMarca) this.host.classList.add('lg-on');
      // Si el bocadillo cambia de tamaño (una nota que crece, una sección que se abre), el
      // cristal le sigue sin otra foto.
      if (typeof ResizeObserver === 'function') {
        this._ro = new ResizeObserver(() => this.reflow());
        this._ro.observe(this.host);
      }
      return true;
    }

    // En directo solo se desenfoca la zona de la ventana (más un margen para el desenfoque y
    // la refracción del borde), no la pantalla entera: es ~5 % del trabajo de antes.
    _recorteVentana() {
      const f = this.foto, k = f.k;
      const pad = Math.ceil(((this.opts.desenfoque != null ? this.opts.desenfoque : CFG.blur) + 60) * k);
      const x0 = Math.max(0, Math.floor((window.screenX - f.region.x) * k) - pad);
      const y0 = Math.max(0, Math.floor((window.screenY - f.region.y) * k) - pad);
      const x1 = Math.min(f.pw, Math.ceil((window.screenX - f.region.x + window.innerWidth) * k) + pad);
      const y1 = Math.min(f.ph, Math.ceil((window.screenY - f.region.y + window.innerHeight) * k) + pad);
      return { x: x0, y: y0, w: Math.max(1, x1 - x0), h: Math.max(1, y1 - y0) };
    }

    // Fondo: la foto (o el fotograma) a media resolución y desenfocada, en f2.
    _hornear(bgra) {
      const gl = this.gl, W0 = this.W0, H0 = this.H0, r = this.recorte, f = this.foto;
      gl.viewport(0, 0, W0, H0);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.f0.fb); gl.useProgram(this.pBg);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.fuente);
      this._u(this.pBg, 'u_recorte', [r.x / f.pw, r.y / f.ph, r.w / f.pw, r.h / f.ph]);
      this._u(this.pBg, 'u_bgTexture', { i: 0 }); this._u(this.pBg, 'u_fondo', leerTema().fondo);
      this._u(this.pBg, 'u_bgra', { i: typeof bgra === 'number' ? bgra : (bgra ? 1 : 0) });
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      // desenfoque: px CSS (el panel lateral lo baja cuando se apaga "Difuminar el fondo").
      if (!this._kernel) this._kernel = kernelGauss((this.opts.desenfoque != null ? this.opts.desenfoque : CFG.blur) * this.foto.k * (this.escalaFbo || 0.5));
      const kernel = this._kernel;
      [[this.pBlurX, this.f0, this.f1], [this.pBlurY, this.f1, this.f2]].forEach(([p, de, a]) => {
        gl.bindFramebuffer(gl.FRAMEBUFFER, a.fb); gl.useProgram(p);
        this._u(p, 'u_resolution', [W0, H0]); this._u(p, 'u_blurRadius', { i: kernel.n }); this._u(p, 'u_blurWeights', kernel.pesos);
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, de.tex); this._u(p, 'u_prevPassTexture', { i: 0 });
        gl.drawArrays(gl.TRIANGLES, 0, 6);
      });
    }

    _subirVideo(video) {
      const gl = this.gl;
      gl.bindTexture(gl.TEXTURE_2D, this.fuente);
      try { gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, video); } catch {}
    }

    // Un fotograma de la captura nativa (BGRA con relleno por fila) a la textura de fondo. Si la
    // zona cambió de tamaño (ventana movida a otro borde, panel más ancho), se rehacen texturas.
    _subirNativo(fr) {
      const gl = this.gl;
      if (fr.ancho !== this.foto.pw || fr.alto !== this.foto.ph) {
        const region = this._nativo ? this._nativo.regionDIP() : this.foto.region;
        this.foto = { pw: fr.ancho, ph: fr.alto, k: fr.ancho / region.w, region };
        this.recorte = { x: 0, y: 0, w: fr.ancho, h: fr.alto };
        this.W0 = fr.ancho; this.H0 = fr.alto; this._kernel = null;
        gl.deleteTexture(this.fuente); this.fuente = this._textura(fr.ancho, fr.alto, null);
        [this.f0, this.f1, this.f2].forEach((d) => { if (d) { gl.deleteFramebuffer(d.fb); gl.deleteTexture(d.tex); } });
        this.f0 = this._destino(this.W0, this.H0); this.f1 = this._destino(this.W0, this.H0); this.f2 = this._destino(this.W0, this.H0);
      }
      gl.bindTexture(gl.TEXTURE_2D, this.fuente);
      gl.pixelStorei(gl.UNPACK_ROW_LENGTH, fr.paso / 4);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, fr.ancho, fr.alto, gl.RGBA, gl.UNSIGNED_BYTE, fr.datos);
      gl.pixelStorei(gl.UNPACK_ROW_LENGTH, 0);
    }

    // Cada fotograma de pantalla: si hay uno nuevo detrás (la captura no da nada si no cambió),
    // se sube y se desenfoca; si el elemento o la ventana se han movido, se vuelve a medir. Solo
    // se repinta cuando algo ha cambiado: con el fondo quieto no se gasta nada.
    _seguirNativo(nat) {
      this._nativo = nat;
      let ultimo = '';
      const paso = () => {
        if (!this.gl) return;
        // Pase lo que pase en un fotograma (la GPU se reinicia, cambia la resolución...), el
        // bucle sigue: la captura se recupera sola y mientras tanto queda el último fondo.
        try {
          let pintar = false;
          if (nat.sincronizar && nat.sincronizar()) {
            const region = nat.regionDIP();
            this.foto.region = region; this.foto.k = this.foto.pw / region.w;
            pintar = true;
          }
          const fr = pausaCaptura ? null : nat.captura.leer();
          if (fr) { this._subirNativo(fr); this._hornear(2); pintar = true; }
          const r = this.host.getBoundingClientRect();
          const clave = r.left + ',' + r.top + ',' + r.width + ',' + r.height + ',' + window.screenX + ',' + window.screenY;
          if (clave !== ultimo) { ultimo = clave; this._medir(); pintar = true; }
          if (pintar) this.draw();
        } catch (e) {
          if (!this._avisado) { this._avisado = true; console.warn('[glass] captura nativa:', e && e.message); }
        }
        this._rafVivo = requestAnimationFrame(paso);
      };
      this._rafVivo = requestAnimationFrame(paso);
    }

    // Con cada fotograma nuevo de la pantalla: subirlo, desenfocarlo y repintar el cristal.
    _seguirVivo(video) {
      if (typeof video.requestVideoFrameCallback !== 'function') return;
      this._video = video;
      const otro = () => {
        if (!this.gl) return;
        // Si la ventana se ha movido (se puede arrastrar), el recorte va con ella.
        const r = this._recorteVentana();
        if (r.x !== this.recorte.x || r.y !== this.recorte.y || r.w !== this.recorte.w || r.h !== this.recorte.h) {
          const gl = this.gl;
          this.recorte = r;
          this.W0 = Math.max(1, Math.ceil(r.w / 2)); this.H0 = Math.max(1, Math.ceil(r.h / 2));
          [this.f0, this.f1, this.f2].forEach((d) => { if (d) { gl.deleteFramebuffer(d.fb); gl.deleteTexture(d.tex); } });
          this.f0 = this._destino(this.W0, this.H0); this.f1 = this._destino(this.W0, this.H0); this.f2 = this._destino(this.W0, this.H0);
        }
        this._medir();
        if (!pausaCaptura) { this._subirVideo(video); this._hornear(false); }
        this.draw();
        this._vfc = video.requestVideoFrameCallback(otro);
      };
      this._vfc = video.requestVideoFrameCallback(otro);
    }

    reflow() {
      if (!this.gl) return;
      this._medir();
      this.draw();
    }

    draw() {
      const gl = this.gl; if (!gl) return;
      const W = this.canvas.width, H = this.canvas.height, dpr = this.dpr;
      gl.bindVertexArray(this.vao);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, W, H);
      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
      const p = this.pMain; gl.useProgram(p);
      const tema = leerTema();
      const s = this.opts.scale || 1;
      const off = this.opts.offset || { x: 0, y: 0 };   // desplazamiento al encoger (salir)
      // La forma puede seguir más allá del elemento por algún lado (extiende): así ese lado
      // no se redondea (el panel del dock, pegado al borde de la pantalla).
      const ext = this.opts.extiende || {};
      const eL = ext.left || 0, eR = ext.right || 0, eT = ext.top || 0, eB = ext.bottom || 0;
      const fw = this.forma.w + eL + eR, fh = this.forma.h + eT + eB;
      const cx = (this.margen + this.forma.w / 2 + (eR - eL) / 2 + off.x) * dpr;
      const cy = H - (this.margen + this.forma.h / 2 + (eB - eT) / 2 + off.y) * dpr;
      const tail = this.opts.tail;
      const f = this.foto, c = this.caja;
      const offX = f.region ? (window.screenX - f.region.x) : f.offX;
      const offY = f.region ? (window.screenY - f.region.y) : f.offY;
      const rc = this.recorte;
      this._u(p, 'u_uvOrigin', [((c.left + offX) * f.k - rc.x) / rc.w, ((c.top + c.height + offY) * f.k - rc.y) / rc.h]);
      this._u(p, 'u_uvScale', [c.width * f.k / rc.w, -c.height * f.k / rc.h]);
      this._u(p, 'u_resolution', [W, H]); this._u(p, 'u_dpr', dpr);
      this._u(p, 'u_shapeCenter', [cx, cy]);
      // sx / sy: estirado al vuelo (brotar / sumir), como una gota que se alarga al moverse.
      // redondo (0-1): cuánto se acerca a una píldora del todo redonda (la gota, al vuelo).
      const sx = this.opts.sx || 1, sy = this.opts.sy || 1;
      const radioMax = Math.min(fw * sx, fh * sy) / 2 * s;
      this._u(p, 'u_shapeWidth', fw * s * sx); this._u(p, 'u_shapeHeight', fh * s * sy);
      this._u(p, 'u_shapeRadius', Math.min(radioMax, Math.max(this.opts.radius * s, radioMax * (this.opts.redondo || 0))));
      // De gota, esquinas de círculo (n = 2): con la superelipse saldría un rectángulo.
      this._u(p, 'u_shapeRoundness', this.opts.roundness + (2 - this.opts.roundness) * (this.opts.redondo || 0));
      this._u(p, 'u_showShape1', { i: tail ? 1 : 0 });
      this._u(p, 'u_tailCenter', tail ? [(this.margen + tail.x) * dpr, H - (this.margen + tail.y) * dpr] : [0, 0]);
      this._u(p, 'u_tailRadius', (this.opts.tailRadius || 11) * (tail && tail.s != null ? tail.s : 1));
      this._u(p, 'u_mergeRate', (18 * dpr) / H);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.f2.tex); this._u(p, 'u_blurredBg', { i: 0 });
      this._u(p, 'u_tint', this.opts.tinte != null ? [tema.tint[0], tema.tint[1], tema.tint[2], this.opts.tinte] : tema.tint);
      this._u(p, 'u_refThickness', CFG.refThickness); this._u(p, 'u_refDistance', CFG.refDistance);
      this._u(p, 'u_refFactor', CFG.refFactor);
      this._u(p, 'u_refFresnelRange', CFG.fresRange); this._u(p, 'u_refFresnelHardness', CFG.fresHard); this._u(p, 'u_refFresnelFactor', CFG.fresFactor);
      this._u(p, 'u_glareRange', CFG.glareRange); this._u(p, 'u_glareHardness', CFG.glareHard); this._u(p, 'u_glareFactor', CFG.glareFactor);
      this._u(p, 'u_glareConvergence', CFG.glareConvergence); this._u(p, 'u_glareOppositeFactor', CFG.glareOpposite);
      this._u(p, 'u_glareAngle', CFG.glareAngle * Math.PI / 180);
      this._u(p, 'u_shadowExpand', CFG.shadow.expand);
      this._u(p, 'u_shadowFactor', this.opts.sombra === false ? 0 : (tema.claro ? CFG.shadow.factor * 0.55 : CFG.shadow.factor));
      this._u(p, 'u_shadowOffset', [CFG.shadow.x, -CFG.shadow.y]);
      this._u(p, 'u_shadowMax', Math.max(8, this.margen - Math.abs(CFG.shadow.y) - 4));
      this._u(p, 'u_opacity', this.opacity);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }

    // Animación de entrada: la forma crece con muelle y la gotita sale de dentro.
    entrar(ms = 420) {
      cancelAnimationFrame(this._raf);
      const t0 = performance.now();
      const muelle = (t) => 1 - Math.exp(-6.5 * t) * Math.cos(9 * t);   // rebota un pelo y se asienta
      const paso = (ahora) => {
        if (!this.gl) return;
        const t = Math.min(1, Math.max(0, (ahora - t0) / ms));
        this.opts.scale = 0.9 + 0.1 * muelle(t);
        this.opacity = Math.min(1, t * 3);
        if (this.opts.tail) this.opts.tail.s = Math.max(0, Math.min(1.15, (t - 0.18) / 0.5));
        this.draw();
        if (t < 1) this._raf = requestAnimationFrame(paso);
        else { this.opts.scale = 1; this.opacity = 1; if (this.opts.tail) this.opts.tail.s = 1; this.draw(); }
      };
      // El primer fotograma se pinta ya, antes de que el elemento se haga visible: si no, se
      // vería un instante el cristal entero antes de que arranque la animación.
      paso(t0);
    }

    // Salida: más rápida que la entrada y acelerando (ease-in), encogiendo y desvaneciéndose;
    // si se da `hacia` (un punto del elemento, p. ej. la gotita), encoge yendo hacia él, como
    // si volviera a meterse por donde salió.
    salir(ms = 200, hacia) {
      return new Promise((res) => {
        const t0 = performance.now();
        const cx = this.forma.w / 2, cy = this.forma.h / 2;
        const paso = (ahora) => {
          if (!this.gl) return res();
          const t = Math.min(1, (ahora - t0) / ms);
          const k = t * t;
          this.opts.scale = 1 - 0.14 * k;
          this.opacity = 1 - k;
          if (hacia) this.opts.offset = { x: (hacia.x - cx) * 0.35 * k, y: (hacia.y - cy) * 0.35 * k };
          if (this.opts.tail) this.opts.tail.s = Math.max(0, 1 - t * 1.6);
          this.draw();
          if (t < 1) this._raf = requestAnimationFrame(paso); else res();
        };
        cancelAnimationFrame(this._raf);
        this._raf = requestAnimationFrame(paso);
      });
    }

    // Aparición suave, sin muelle: solo se funde (el panel grande del dock, que ya ha
    // entrado deslizándose). `alFinal` se llama al acabar.
    aparecer(ms = 320, alFinal) {
      cancelAnimationFrame(this._raf);
      const t0 = performance.now();
      this.opts.scale = 1;
      const paso = (ahora) => {
        if (!this.gl) return;
        const t = Math.min(1, Math.max(0, (ahora - t0) / ms));
        this.opacity = 1 - Math.pow(1 - t, 3);
        this.draw();
        if (t < 1) this._raf = requestAnimationFrame(paso);
        else if (alFinal) alFinal();
      };
      paso(t0);
    }

    // Entrada líquida desde un punto de fuera (el borde de la pantalla): asoma una gota por
    // ahí, viaja estirándose hasta su sitio y se abre en la forma con un rebote; la gota de
    // la que sale se queda atrás y se suelta. `desde` va en px del elemento.
    brotar(ms = 780, desde, alFinal) {
      cancelAnimationFrame(this._raf);
      const cx = this.forma.w / 2, cy = this.forma.h / 2;
      const dx = desde.x - cx, dy = desde.y - cy;
      const horizontal = Math.abs(dx) >= Math.abs(dy);
      const radioGota = this.opts.tailRadius;
      this.opts.tail = { x: desde.x, y: desde.y, s: 0 };
      this.opts.tailRadius = 24;
      this._medir();   // que la gota quepa en el lienzo
      const muelle = (t) => 1 - Math.exp(-6 * t) * Math.cos(8.5 * t);
      const t0 = performance.now();
      const paso = (ahora) => {
        if (!this.gl) return;
        const t = Math.min(1, Math.max(0, (ahora - t0) / ms));
        // Viaja pequeña (como gota) y, al llegar, se abre con muelle.
        const viaje = 1 - Math.pow(1 - Math.min(1, t / 0.42), 3);
        const abre = Math.max(0, (t - 0.3) / 0.7);
        const estira = Math.sin(Math.PI * Math.min(1, t / 0.42)) * (1 - Math.min(1, abre * 2.5));
        this.opts.offset = { x: dx * (1 - viaje), y: dy * (1 - viaje) };
        this.opts.scale = 0.16 + 0.12 * viaje + 0.72 * muelle(abre);
        this.opts.sx = horizontal ? 1 + 0.7 * estira : 1 - 0.25 * estira;
        this.opts.sy = horizontal ? 1 - 0.25 * estira : 1 + 0.7 * estira;
        this.opts.redondo = 1 - Math.min(1, abre * 1.6);
        this.opts.tail.s = Math.min(1, t * 10) * Math.max(0, 1 - Math.max(0, t - 0.2) / 0.3);
        this.opacity = Math.min(1, t * 6);
        this.draw();
        if (t < 1) { this._raf = requestAnimationFrame(paso); return; }
        Object.assign(this.opts, { offset: null, scale: 1, sx: 1, sy: 1, redondo: 0, tail: null, tailRadius: radioGota });
        this.opacity = 1;
        this.reflow();
        if (alFinal) alFinal();
      };
      paso(t0);
    }

    // Lo contrario: amaga, se recoge en una gota, sale disparada hacia `hacia` estirándose y
    // se funde con otra gota que asoma en el borde, que también se va.
    sumir(ms = 560, hacia) {
      return new Promise((res) => {
        cancelAnimationFrame(this._raf);
        const cx = this.forma.w / 2, cy = this.forma.h / 2;
        const dx = hacia.x - cx, dy = hacia.y - cy;
        const horizontal = Math.abs(dx) >= Math.abs(dy);
        this.opts.tail = { x: hacia.x, y: hacia.y, s: 0 };
        this.opts.tailRadius = 24;
        this._medir();
        const t0 = performance.now();
        const paso = (ahora) => {
          if (!this.gl) return res();
          const t = Math.min(1, (ahora - t0) / ms);
          const entre = (a, b) => Math.min(1, Math.max(0, (t - a) / (b - a)));
          const amago = t < 0.12 ? Math.sin(Math.PI * t / 0.12) * 0.04 : 0;
          const c = entre(0.08, 0.5), cierra = c * c * (3 - 2 * c);    // se recoge en gota
          const v = entre(0.38, 1), viaje = v * v;                     // y se va acelerando
          const estira = Math.sin(Math.PI * v);
          this.opts.offset = { x: dx * viaje, y: dy * viaje };
          this.opts.scale = 1 - amago - 0.78 * cierra;
          this.opts.redondo = cierra;
          this.opts.sx = horizontal ? 1 + 0.55 * estira : 1 - 0.25 * estira;
          this.opts.sy = horizontal ? 1 - 0.25 * estira : 1 + 0.55 * estira;
          this.opts.tail.s = entre(0.6, 0.8) * (1 - entre(0.88, 1));
          this.opacity = 1 - entre(0.86, 1);
          this.draw();
          if (t < 1) this._raf = requestAnimationFrame(paso); else res();
        };
        this._raf = requestAnimationFrame(paso);
      });
    }

    // Mover la gotita (el bocadillo se ha recolocado).
    setTail(tail) {
      this.opts.tail = tail ? Object.assign({ s: 1 }, tail) : null;
      this.reflow();
    }

    detach() {
      cancelAnimationFrame(this._raf);
      cancelAnimationFrame(this._rafVivo);
      if (this._video && this._vfc != null) { try { this._video.cancelVideoFrameCallback(this._vfc); } catch {} }
      if (this._ro) { this._ro.disconnect(); this._ro = null; }
      // Primero se deja de ver (fuera del árbol y oculto) y el contexto se suelta DOS fotogramas
      // después: si se perdía en el mismo instante, el compositor podía pintar ese fotograma un
      // lienzo sin contexto (el rectángulo blanco que salía a veces al cerrar).
      this.canvas.style.display = 'none';
      if (this.canvas.parentNode) this.canvas.remove();
      // Si al mismo elemento ya se le ha puesto otro cristal (se reabrió mientras este se
      // iba), la marca se queda para él.
      if (!this.host.querySelector(':scope > .lg-canvas')) this.host.classList.remove('lg-on');
      const gl = this.gl;
      this.gl = null;
      if (!gl) return;
      const soltar = () => {
        try {
          [this.f0, this.f1, this.f2].forEach((d) => { if (d) { gl.deleteFramebuffer(d.fb); gl.deleteTexture(d.tex); } });
          if (this.fuente) gl.deleteTexture(this.fuente);
          const lose = gl.getExtension('WEBGL_lose_context'); if (lose) lose.loseContext();
        } catch {}
        this.f0 = this.f1 = this.f2 = this.fuente = null;
      };
      if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => requestAnimationFrame(soltar));
      else soltar();
    }
  }

  async function attach(host, opts) {
    if (!host || !supported()) return null;
    const g = new Glass(host, opts);
    try {
      const ok = await g.init();
      if (!ok) { g.detach(); return null; }
      return g;
    } catch (e) {
      console.warn('[glass]', e && e.message);
      try { g.detach(); } catch {}
      return null;
    }
  }

  // La pantalla en directo para el cristal (vídeo de la pantalla en la que está la ventana).
  // La ventana se excluye de la captura (main.js, 'fuente-pantalla'), así no se ve a sí misma.
  // Devuelve { video, region, parar() } o null.
  async function pantallaEnVivo(fps) {
    let ipc = null;
    try { ipc = require('electron').ipcRenderer; } catch { return null; }
    try {
      const f = await ipc.invoke('fuente-pantalla');
      if (!f) return null;
      const stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { mandatory: {
        chromeMediaSource: 'desktop', chromeMediaSourceId: f.id,
        maxWidth: Math.round(f.region.w / 2), maxHeight: Math.round(f.region.h / 2), maxFrameRate: fps || 60 } } });
      const video = document.createElement('video');
      video.muted = true; video.srcObject = stream;
      await video.play();
      if (!video.videoWidth) await new Promise(r => video.addEventListener('loadedmetadata', r, { once: true }));
      return { video, region: f.region, parar() { stream.getTracks().forEach(t => t.stop()); video.srcObject = null; } };
    } catch (e) {
      console.warn('[glass] sin pantalla en directo:', e && e.message);
      return null;
    }
  }

  // La zona de detrás del cristal con DXGI Desktop Duplication (src/captura-dxgi.js): 1-2
  // fotogramas de retraso, sin la cola de vídeo de Chromium. zona: { x, y, w, h } en px de la
  // ventana (o una función que la devuelva); se mueve con la ventana. Devuelve null si no se
  // puede (no es Windows, gráfica sin Desktop Duplication...) y entonces se usa pantallaEnVivo.
  async function pantallaNativa(zona) {
    let ipc = null, Captura = null;
    try {
      ipc = require('electron').ipcRenderer;
      Captura = require('./captura-dxgi.js').CapturaDXGI;
    } catch { return null; }
    if (!Captura || !Captura.disponible()) return null;
    const m = await ipc.invoke('fuente-dxgi').catch(() => null);   // y la ventana deja de salir en capturas
    if (!m) return null;
    const zonaDIP = () => {
      const z = typeof zona === 'function' ? zona() : zona;
      return { x: window.screenX + z.x, y: window.screenY + z.y, w: z.w, h: z.h };
    };
    const aFis = (z) => ({ x: m.fis.x + (z.x - m.dip.x) * m.sf, y: m.fis.y + (z.y - m.dip.y) * m.sf, w: z.w * m.sf, h: z.h * m.sf });
    const aDip = (z) => ({ x: m.dip.x + (z.x - m.fis.x) / m.sf, y: m.dip.y + (z.y - m.fis.y) / m.sf, w: z.w / m.sf, h: z.h / m.sf });
    let actual = zonaDIP();
    const c = Captura.crear(aFis(actual), { mitad: true });
    if (!c) return null;
    // El primer fotograma (la imagen entera del escritorio) llega enseguida.
    let primero = null;
    for (let i = 0; i < 30 && !primero; i++) { primero = c.leer(); if (!primero) await new Promise(r => setTimeout(r, 8)); }
    c._primero = primero;
    return {
      captura: c,
      regionDIP: () => aDip(c.zona),
      sincronizar() {
        const z = zonaDIP();
        if (z.x === actual.x && z.y === actual.y && z.w === actual.w && z.h === actual.h) return false;
        actual = z;
        c.mover(aFis(z));
        return true;
      },
      parar() { c.cerrar(); },
    };
  }

  // Mientras el usuario hace una captura de pantalla, la ventana deja de estar excluida (para salir
  // en ella): el cristal se queda con su último fotograma para no verse a sí mismo (main.js).
  let pausaCaptura = false;
  try { require('electron').ipcRenderer.on('captura-pausa', (_, on) => { pausaCaptura = !!on; }); } catch {}

  global.LiquidGlass = { attach, supported, pantallaEnVivo, pantallaNativa, CFG };
})(typeof window !== 'undefined' ? window : globalThis);
