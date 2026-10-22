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
uniform vec3 u_fondo;
void main() {
  vec4 c = texture(u_bgTexture, v_uv).bgra;
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
  fragColor = vec4(c.rgb, c.a * u_opacity);
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

  function leerTema() {
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

  // ── El cristal de un elemento ───────────────────────────────────────────────
  // La esquina de superelipse (n = 5) recorta menos que un círculo del mismo radio: para que
  // el cristal case con el border-radius del elemento hace falta un radio ~2,3 veces mayor.
  const SUPERELIPSE_POR_CSS = 1 / 0.44;

  class Glass {
    constructor(host, opts) {
      this.host = host;
      const css = parseFloat(getComputedStyle(host).borderTopLeftRadius) || 26;
      // Opciones: foto: una foto de la ventana ya pedida (promesa); margen: px de lienzo
      // alrededor (para la sombra); sombra: false para no pintarla; extiende: {left,right,
      // top,bottom} px que la forma sigue más allá del elemento (para que un lado pegado a
      // un borde no se redondee); dpr: resolución del lienzo; sinMarca: no poner .lg-on
      // (quien lo usa decide cuándo quitar su fondo).
      this.opts = Object.assign({ radius: css * SUPERELIPSE_POR_CSS, roundness: CFG.roundness, tail: null, tailRadius: 11, scale: 1,
        foto: null, margen: null, sombra: true, extiende: null, dpr: null, sinMarca: false }, opts || {});
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
      const foto = this.opts.foto ? await this.opts.foto : await capturarVentana();
      if (!foto || !this.host.isConnected) return false;
      const gl = this.canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: false, antialias: false });
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

      // Dónde cae la página dentro de la foto (px CSS → px de la foto).
      this.foto = { pw: foto.pw, ph: foto.ph, k: foto.pw / foto.iw, offX: foto.offX || 0, offY: foto.offY || 0 };

      // Fondo a media resolución (con 30 px de desenfoque no se nota y cuesta 4 veces menos).
      const W0 = Math.max(1, Math.ceil(foto.pw / 2)), H0 = Math.max(1, Math.ceil(foto.ph / 2));
      const datos = foto.data instanceof Uint8Array ? foto.data : new Uint8Array(foto.data);
      const fuente = this._textura(foto.pw, foto.ph, datos);
      const f0 = this._destino(W0, H0), f1 = this._destino(W0, H0);
      this.f2 = this._destino(W0, H0);
      const tema = leerTema();
      gl.viewport(0, 0, W0, H0);
      gl.bindFramebuffer(gl.FRAMEBUFFER, f0.fb); gl.useProgram(this.pBg);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, fuente);
      this._u(this.pBg, 'u_bgTexture', { i: 0 }); this._u(this.pBg, 'u_fondo', tema.fondo);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      const kernel = kernelGauss(CFG.blur * this.foto.k / 2);
      [[this.pBlurX, f0, f1], [this.pBlurY, f1, this.f2]].forEach(([p, de, a]) => {
        gl.bindFramebuffer(gl.FRAMEBUFFER, a.fb); gl.useProgram(p);
        this._u(p, 'u_resolution', [W0, H0]); this._u(p, 'u_blurRadius', { i: kernel.n }); this._u(p, 'u_blurWeights', kernel.pesos);
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, de.tex); this._u(p, 'u_prevPassTexture', { i: 0 });
        gl.drawArrays(gl.TRIANGLES, 0, 6);
      });
      // Lo intermedio ya no hace falta: solo se queda el fondo desenfocado.
      gl.deleteTexture(fuente);
      [f0, f1].forEach((f) => { gl.deleteFramebuffer(f.fb); gl.deleteTexture(f.tex); });

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
      this._u(p, 'u_uvOrigin', [(c.left + f.offX) * f.k / f.pw, (c.top + c.height + f.offY) * f.k / f.ph]);
      this._u(p, 'u_uvScale', [c.width * f.k / f.pw, -c.height * f.k / f.ph]);
      this._u(p, 'u_resolution', [W, H]); this._u(p, 'u_dpr', dpr);
      this._u(p, 'u_shapeCenter', [cx, cy]);
      this._u(p, 'u_shapeWidth', fw * s); this._u(p, 'u_shapeHeight', fh * s);
      this._u(p, 'u_shapeRadius', Math.min(this.opts.radius, Math.min(fw, fh) / 2) * s);
      this._u(p, 'u_shapeRoundness', this.opts.roundness);
      this._u(p, 'u_showShape1', { i: tail ? 1 : 0 });
      this._u(p, 'u_tailCenter', tail ? [(this.margen + tail.x) * dpr, H - (this.margen + tail.y) * dpr] : [0, 0]);
      this._u(p, 'u_tailRadius', (this.opts.tailRadius || 11) * (tail && tail.s != null ? tail.s : 1));
      this._u(p, 'u_mergeRate', (18 * dpr) / H);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.f2.tex); this._u(p, 'u_blurredBg', { i: 0 });
      this._u(p, 'u_tint', tema.tint);
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

    // Mover la gotita (el bocadillo se ha recolocado).
    setTail(tail) {
      this.opts.tail = tail ? Object.assign({ s: 1 }, tail) : null;
      this.reflow();
    }

    detach() {
      cancelAnimationFrame(this._raf);
      if (this._ro) { this._ro.disconnect(); this._ro = null; }
      if (this.canvas.parentNode) this.canvas.remove();
      // Si al mismo elemento ya se le ha puesto otro cristal (se reabrió mientras este se
      // iba), la marca se queda para él.
      if (!this.host.querySelector(':scope > .lg-canvas')) this.host.classList.remove('lg-on');
      try { const lose = this.gl && this.gl.getExtension('WEBGL_lose_context'); if (lose) lose.loseContext(); } catch {}
      this.gl = null;
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

  global.LiquidGlass = { attach, supported, CFG };
})(typeof window !== 'undefined' ? window : globalThis);
