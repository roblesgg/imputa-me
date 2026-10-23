// Temas de color de imputa.me. Vive aparte de main.js para poder usarlo también desde las
// herramientas de captura (tools/), sin arrancar la app entera.
//
// Cada tema define la paleta completa. Se envía a TODAS las ventanas (y a los iframes del
// dock) por IPC y cada página la aplica como variables CSS; no se usa insertCSS porque ese
// solo llega al frame principal y dejaría las vistas del dock sin tema.
// `base` es el RGB del fondo, al que se le aplica la opacidad elegida por el usuario.
//
// 2.8: «Noche cálida» (oscuro, el de por defecto) y «Luz» (claro) traen además sus brillos de
// fondo (glow*), el tinte del cristal líquido (glass) y los textos terciarios. Los temas de
// antes siguen funcionando: lo que no definen se deduce de su esquema.
const THEMES = {
  noche:    { name:'Noche cálida', base:'20,16,19', accent:'#ffb383', accent2:'#ff9f5a', surface:'#1f1a1d', scheme:'dark',
              glass:'22,18,21', glassTint:0.72,
              glow1:'rgba(255,128,48,.17)', glow2:'rgba(170,110,255,.11)', glow3:'rgba(255,160,120,.06)' },
  luz:      { name:'Luz', base:'247,243,240', accent:'#c2510f', accent2:'#ff8a3d', surface:'#ffffff', scheme:'light',
              glass:'255,255,255', glassTint:0.65,
              glow1:'rgba(255,190,150,.42)', glow2:'rgba(200,190,255,.34)', glow3:'rgba(180,235,215,.32)' },
  // 2.8.3: más de la misma familia (fondo con brillos y cristal a juego).
  aurora:     { name:'Aurora', base:'11,19,23', accent:'#86f0d4', accent2:'#22c39b', surface:'#142026', scheme:'dark',
                glass:'14,22,26', glassTint:0.72,
                glow1:'rgba(40,210,165,.16)', glow2:'rgba(120,110,255,.14)', glow3:'rgba(80,200,255,.06)' },
  medianoche: { name:'Medianoche', base:'12,14,29', accent:'#a9bcff', accent2:'#6f8cff', surface:'#171a33', scheme:'dark',
                glass:'15,17,34', glassTint:0.72,
                glow1:'rgba(90,120,255,.19)', glow2:'rgba(200,90,255,.11)', glow3:'rgba(120,200,255,.06)' },
  atardecer:  { name:'Atardecer', base:'25,13,23', accent:'#ffadc6', accent2:'#ff6f91', surface:'#29162a', scheme:'dark',
                glass:'28,16,26', glassTint:0.72,
                glow1:'rgba(255,111,145,.17)', glow2:'rgba(255,170,80,.12)', glow3:'rgba(160,90,255,.07)' },
  musgo:      { name:'Musgo', base:'15,19,13', accent:'#d4e58c', accent2:'#93b24a', surface:'#1c2419', scheme:'dark',
                glass:'18,22,16', glassTint:0.72,
                glow1:'rgba(160,195,80,.15)', glow2:'rgba(255,200,90,.10)', glow3:'rgba(90,200,150,.06)' },
  lavanda:    { name:'Lavanda', base:'245,242,251', accent:'#5b3fd0', accent2:'#8b6cff', surface:'#ffffff', scheme:'light',
                glass:'255,255,255', glassTint:0.65,
                glow1:'rgba(185,165,255,.42)', glow2:'rgba(255,180,220,.32)', glow3:'rgba(170,220,255,.30)' },
  menta:      { name:'Menta', base:'239,247,243', accent:'#0b7357', accent2:'#1fb386', surface:'#ffffff', scheme:'light',
                glass:'255,255,255', glassTint:0.65,
                glow1:'rgba(130,228,195,.42)', glow2:'rgba(170,205,255,.32)', glow3:'rgba(255,228,160,.30)' },
  arena:      { name:'Arena', base:'247,241,232', accent:'#8f520f', accent2:'#d98a2b', surface:'#fffdf9', scheme:'light',
                glass:'255,253,249', glassTint:0.65,
                glow1:'rgba(255,200,130,.44)', glow2:'rgba(255,165,145,.28)', glow3:'rgba(195,225,175,.28)' },
  indigo:   { name:'Índigo',   base:'18,18,28',    accent:'#818cf8', accent2:'#6366f1', surface:'#1c1c2a', scheme:'dark' },
  grafito:  { name:'Grafito',  base:'16,16,18',    accent:'#a1a1aa', accent2:'#71717a', surface:'#1b1b1e', scheme:'dark' },
  pizarra:  { name:'Pizarra',  base:'24,28,36',    accent:'#94a3b8', accent2:'#64748b', surface:'#212733', scheme:'dark' },
  oceano:   { name:'Océano',   base:'12,22,34',    accent:'#38bdf8', accent2:'#0284c7', surface:'#12212f', scheme:'dark' },
  bosque:   { name:'Bosque',   base:'12,24,20',    accent:'#34d399', accent2:'#059669', surface:'#122420', scheme:'dark' },
  vino:     { name:'Vino',     base:'28,14,20',    accent:'#fb7185', accent2:'#e11d48', surface:'#291520', scheme:'dark' },
  ambar:    { name:'Ámbar',    base:'28,20,10',    accent:'#fbbf24', accent2:'#d97706', surface:'#2a1f12', scheme:'dark' },
  claro:    { name:'Claro',    base:'244,244,249', accent:'#4f46e5', accent2:'#4338ca', surface:'#ffffff', scheme:'light' },
};
const DEFAULT_THEME = 'noche';

// Color de acento (botones, resaltados) elegible aparte del fondo: cada tema trae el
// suyo por defecto, pero se puede cambiar sin tocar los grises/negros/blancos del fondo.
const ACCENTS = {
  indigo:   { name:'Índigo',   accent:'#818cf8', accent2:'#6366f1' },
  azul:     { name:'Azul',     accent:'#38bdf8', accent2:'#0284c7' },
  turquesa: { name:'Turquesa', accent:'#2dd4bf', accent2:'#0d9488' },
  verde:    { name:'Verde',    accent:'#34d399', accent2:'#059669' },
  ambar:    { name:'Ámbar',    accent:'#fbbf24', accent2:'#d97706' },
  naranja:  { name:'Naranja',  accent:'#ffb383', accent2:'#ff9f5a' },
  rojo:     { name:'Rojo',     accent:'#fb7185', accent2:'#e11d48' },
  rosa:     { name:'Rosa',     accent:'#f472b6', accent2:'#db2777' },
  violeta:  { name:'Violeta',  accent:'#a78bfa', accent2:'#7c3aed' },
  gris:     { name:'Gris',     accent:'#a1a1aa', accent2:'#71717a' },
  // 2.8.3
  coral:    { name:'Coral',    accent:'#ffa494', accent2:'#ff6f59' },
  melocoton:{ name:'Melocotón',accent:'#ffc6a0', accent2:'#ff9b6a' },
  oro:      { name:'Oro',      accent:'#ffd66b', accent2:'#e0a100' },
  lima:     { name:'Lima',     accent:'#c8f170', accent2:'#7cc316' },
  menta:    { name:'Menta',    accent:'#86f0d4', accent2:'#22c39b' },
  cielo:    { name:'Cielo',    accent:'#9fd4ff', accent2:'#4ba3f5' },
  lavanda:  { name:'Lavanda',  accent:'#c9b8ff', accent2:'#9073ff' },
  fucsia:   { name:'Fucsia',   accent:'#f5a3ff', accent2:'#c13bdb' },
  cereza:   { name:'Cereza',   accent:'#ff9db0', accent2:'#e23a5f' },
};

// El blur (acrílico) está SIEMPRE puesto. El deslizador controla la opacidad del
// tinte oscuro que va sobre el cristal: más opaco (tapa el blur, más sólido) o más
// translúcido (se ve más el blur del escritorio). Como el material no cambia, no
// aparece el "gris" de togglear el material en caliente.
function bgAlphaFromOpacity(op) {
  const x = Math.max(0, Math.min(100, op == null ? 50 : Number(op))) / 100;
  // El acrílico de Windows YA pone su propio tinte (grisáceo). Si nuestro tinte baja
  // demasiado, manda el suyo y el resultado se ve lavado/blanquecino en vez de "tu color
  // con el fondo difuminado". Por eso el mínimo no baja de ~0.30: en todo el recorrido
  // se sigue viendo el color del tema, cambiando cuánto se transparenta.
  return (0.30 + x * 0.64).toFixed(3);
}

function hexToRgb(hex) {
  const h = String(hex || '').replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16);
  return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
}

// Paleta ya resuelta (incluye el --bg con la opacidad elegida) para un juego de ajustes.
// Se manda a los renderers, que la aplican como variables CSS: así llega también a las
// vistas del dock, que van en iframes (insertCSS solo alcanzaría al frame principal).
function themeVars(settings) {
  const s = settings || {};
  const t = THEMES[s.theme] || THEMES[DEFAULT_THEME];
  const acc = ACCENTS[s.accent];   // si no hay elegido, manda el del tema
  const light = t.scheme === 'light';
  // Translucidez elegida (0 = todo cristal, 1 = mate). Solo la usa el panel lateral.
  const x = Math.max(0, Math.min(100, s.bgOpacity == null ? 85 : Number(s.bgOpacity))) / 100;
  const accent = acc ? acc.accent : t.accent;
  const accent2 = acc ? acc.accent2 : t.accent2;
  return {
    key: s.theme && THEMES[s.theme] ? s.theme : DEFAULT_THEME,
    // 2.8.3: las ventanas sueltas van siempre macizas. Con el fondo casi transparente,
    // Windows no borraba lo de detrás al hacer scroll y el texto salía doble o triple.
    // La translucidez (bgOpacity) es solo del panel lateral, que la hace con cristal.
    bg: `rgba(${t.base},1)`,
    opacidadFondo: x,   // 1 = mate; por debajo, el panel lateral lleva cristal con ese tinte
    bg2: light ? 'rgba(118,118,128,0.09)' : 'rgba(255,255,255,0.065)',
    bg3: light ? 'rgba(118,118,128,0.16)' : 'rgba(255,255,255,0.11)',
    border: light ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.08)',
    text: light ? '#1d1d1f' : '#f6f2ee',
    text2: light ? 'rgba(60,60,67,0.64)' : 'rgba(246,240,234,0.62)',
    text3: light ? 'rgba(60,60,67,0.42)' : 'rgba(246,240,234,0.40)',
    accent,
    accent2,
    accentKey: s.accent || null,
    surface: t.surface,
    panel: `rgba(${hexToRgb(t.surface)},1)`,
    scheme: t.scheme,
    // Cristal líquido de los bocadillos: color del tinte y cuánto tiñe.
    glass: t.glass || (light ? '255,255,255' : hexToRgb(t.surface)),
    glassTint: t.glassTint != null ? t.glassTint : (light ? 0.65 : 0.6),
    liquidGlass: s.liquidGlass !== false,   // interruptor de Ajustes (por defecto, encendido)
    difuminar: s.blurEnabled !== false,     // el cristal del panel lateral, esmerilado o claro
    // Brillos cálidos del fondo. Los temas de antes no los llevan.
    glow1: t.glow1 || 'transparent',
    glow2: t.glow2 || 'transparent',
    glow3: t.glow3 || 'transparent',
    danger: light ? '#e5484d' : '#ff8f8f',
    success: light ? '#2f9e6b' : '#5fd8a8',
  };
}

module.exports = { THEMES, DEFAULT_THEME, ACCENTS, bgAlphaFromOpacity, hexToRgb, themeVars };
