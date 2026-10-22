/**
 * Bocadillo anclado con cristal líquido (2.8): un popup que sale al lado de un elemento, con
 * una gotita que le apunta. Lo usan el calendario (detalles y nueva entrada) y Tareas (los
 * colores de una sección).
 *
 *   const b = Bocadillo.crear(el);   // el: un .entry-popup con su .pop-body dentro
 *   await b.abrir(ancla, alMostrar)  // ancla: el elemento al que apunta (o null: centrado)
 *   b.cerrar() · b.reapuntar(ancla) · b.estaAbierto()
 *
 * Si no hay cristal (sin WebGL, o apagado en Ajustes) se queda el esmerilado de CSS con la
 * misma animación.
 */
(function (global) {
  'use strict';

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  // A la derecha del ancla si cabe, si no a la izquierda; si tampoco, encima o debajo; y sin
  // ancla, centrado. Devuelve dónde ponerlo, dónde va la gotita y desde dónde crece.
  function colocar(el, ancla) {
    const vw = window.innerWidth, vh = window.innerHeight, M = 12, GAP = 18;
    const w = el.offsetWidth, h = el.offsetHeight;
    const r = ancla ? ancla.getBoundingClientRect() : null;
    if (!r || r.width === 0) {
      return { left: Math.round((vw - w) / 2), top: Math.round(Math.max(M, (vh - h) / 2)), tail: null, origin: '50% 50%' };
    }
    // Punto al que apunta: el centro de la parte visible del ancla.
    const visTop = Math.max(r.top, M + 20), visBot = Math.min(r.bottom, vh - M - 20);
    const ay = visBot > visTop ? (visTop + visBot) / 2 : clamp(r.top + r.height / 2, M + 20, vh - M - 20);
    let left, top, tail, origin;
    if (r.right + GAP + w <= vw - M || r.left - GAP - w >= M) {
      const derecha = r.right + GAP + w <= vw - M;
      left = derecha ? r.right + GAP : r.left - GAP - w;
      top = clamp(ay - h / 2, M, Math.max(M, vh - h - M));
      const ty = clamp(ay - top, 30, h - 30);
      tail = { x: derecha ? -13 : w + 13, y: ty };
      origin = `${derecha ? 0 : w}px ${ty}px`;
    } else {
      const ax = clamp(r.left + r.width / 2, M + 30, vw - M - 30);
      left = clamp(ax - w / 2, M, Math.max(M, vw - w - M));
      const abajo = r.bottom + GAP + h <= vh - M || r.top - GAP - h < M;
      top = abajo ? Math.min(r.bottom + GAP, Math.max(M, vh - h - M)) : r.top - GAP - h;
      const tx = clamp(ax - left, 30, w - 30);
      tail = { x: tx, y: abajo ? -13 : h + 13 };
      origin = `${tx}px ${abajo ? 0 : h}px`;
    }
    return { left: Math.round(left), top: Math.round(top), tail, origin };
  }

  function crear(el) {
    let glass = null;
    let token = 0;
    let abierto = false;

    async function abrir(ancla, alMostrar) {
      const mio = ++token;
      abierto = true;
      if (glass) { glass.detach(); glass = null; }
      el.classList.remove('saliendo', 'abierto');
      el.classList.add('pop', 'preparando');
      el.style.display = 'flex';
      const sitio = colocar(el, ancla);
      el.style.left = sitio.left + 'px';
      el.style.top = sitio.top + 'px';
      el.style.setProperty('--origin', sitio.origin);
      const g = global.LiquidGlass ? await global.LiquidGlass.attach(el, { tail: sitio.tail }) : null;
      if (mio !== token) { if (g) g.detach(); return; }
      glass = g;
      if (g) g.entrar(460);
      el.classList.remove('preparando');
      el.classList.add('abierto');
      if (alMostrar) alMostrar();
    }

    // Cierre: el contenido se funde primero (CSS, .saliendo) y el cristal encoge hacia la
    // gotita, de vuelta al bloque del que salió.
    function cerrar() {
      const mio = ++token;
      abierto = false;
      const g = glass;
      glass = null;
      el.classList.remove('abierto');
      el.classList.add('saliendo');
      const fin = () => {
        if (g) g.detach();
        if (mio !== token) return;
        el.style.display = 'none';
        el.classList.remove('saliendo', 'pop', 'preparando');
      };
      if (g) g.salir(210, g.opts.tail ? { x: g.opts.tail.x, y: g.opts.tail.y } : null).then(fin);
      else setTimeout(fin, 200);
    }

    // La gotita sigue al ancla (p. ej. el borrador de una entrada al cambiarle las horas);
    // el bocadillo no se mueve.
    function reapuntar(ancla) {
      if (!glass || !ancla || !glass.opts.tail) return;
      const r = ancla.getBoundingClientRect(), p = el.getBoundingClientRect();
      const t = glass.opts.tail;
      if (t.x < 0 || t.x > p.width) {
        const ay = clamp((Math.max(r.top, 0) + Math.min(r.bottom, window.innerHeight)) / 2, p.top + 30, p.bottom - 30);
        glass.setTail({ x: t.x, y: ay - p.top });
      }
    }

    return { abrir, cerrar, reapuntar, estaAbierto: () => abierto };
  }

  // ── Cristal para todos los demás popups ─────────────────────────────────────
  // Los popups centrados (crear tarea, confirmar, pedir un nombre…) y los menús
  // desplegables se abren cada uno a su manera, casi siempre con style.display. En vez de
  // tocar cada uno, se vigila cuándo se hace visible alguno y se le pone el cristal: antes
  // de que se llegue a pintar se oculta un instante (la foto del fondo no puede salir con
  // él dentro), y aparece ya con el cristal. Los que gestiona crear() llevan .pop y se dejan.
  const SELECTOR_AUTO = '.entry-popup, .ask-card, .imp-card, .dnd-menu, .sort-menu';
  const vestidos = new Map();   // elemento → { glass }

  function seVe(el) { return el.isConnected && el.getClientRects().length > 0; }

  async function vestir(el) {
    if (vestidos.has(el)) return;
    const reg = { glass: null, listo: false };
    vestidos.set(el, reg);
    el.classList.add('lg-auto', 'lg-preparando');
    const g = global.LiquidGlass ? await global.LiquidGlass.attach(el, {}) : null;
    if (vestidos.get(el) !== reg) { if (g) g.detach(); return; }   // se cerró mientras tanto
    reg.glass = g;
    el.classList.remove('lg-preparando');
    reg.listo = true;
    apuntarSitio(el, reg);
    el.classList.add('lg-entrando');
    if (g) g.entrar(440);
    setTimeout(() => el.classList.remove('lg-entrando'), 600);
  }

  // Dónde está y cómo se muestra: hace falta al cerrarlo, cuando ya no se puede medir.
  function apuntarSitio(el, reg) {
    if (!reg.listo || !seVe(el)) return;
    reg.rect = el.getBoundingClientRect();
    reg.display = getComputedStyle(el).display;
  }

  // Al cerrarse, la página lo oculta de golpe (display:none o quitándolo). Para que la salida
  // se vea, en su lugar queda una copia exacta —con su mismo cristal— que hace la animación
  // y desaparece: el contenido se funde primero y luego el cristal encoge.
  function desvestir(el) {
    const reg = vestidos.get(el);
    if (!reg) return;
    vestidos.delete(el);
    el.classList.remove('lg-auto', 'lg-preparando', 'lg-entrando');
    if (!reg.listo || !reg.rect || !document.body) { if (reg.glass) reg.glass.detach(); return; }
    const r = reg.rect;
    const copia = el.cloneNode(true);
    // Lo que la página haya escrito en los campos no viaja con cloneNode.
    const de = el.querySelectorAll('input, textarea, select'), a = copia.querySelectorAll('input, textarea, select');
    de.forEach((x, i) => { if (a[i]) { a[i].value = x.value; if ('checked' in x) a[i].checked = x.checked; } });
    copia.removeAttribute('id');
    copia.querySelectorAll('[id]').forEach((n) => n.removeAttribute('id'));
    copia.querySelectorAll('.lg-canvas').forEach((c) => c.remove());
    copia.classList.remove('lg-auto', 'lg-preparando', 'lg-entrando', 'open');
    Object.assign(copia.style, {
      display: reg.display || 'block', position: 'fixed', left: r.left + 'px', top: r.top + 'px',
      width: r.width + 'px', height: r.height + 'px', margin: '0', transform: 'none',
      maxHeight: 'none', zIndex: '10050', pointerEvents: 'none', visibility: 'visible',
    });
    const g = reg.glass;
    if (g) {
      if (g._ro) { g._ro.disconnect(); g._ro = null; }
      copia.insertBefore(g.canvas, copia.firstChild);
      copia.classList.add('lg-on');
    }
    copia.classList.add('lg-cerrando');
    document.body.appendChild(copia);
    const fin = () => { if (g) g.detach(); copia.remove(); };
    if (g) g.salir(210).then(fin); else setTimeout(fin, 210);
  }

  function revisar() {
    document.querySelectorAll(SELECTOR_AUTO).forEach((el) => {
      if (el.classList.contains('pop') || el.classList.contains('lg-cerrando') || el.dataset.glass === 'no') return;
      if (seVe(el)) { vestir(el); apuntarSitio(el, vestidos.get(el)); } else desvestir(el);
    });
    vestidos.forEach((_, el) => { if (!el.isConnected) desvestir(el); });
  }

  if (typeof MutationObserver === 'function' && typeof document !== 'undefined' && document.body) {
    new MutationObserver(revisar).observe(document.body,
      { subtree: true, childList: true, attributes: true, attributeFilter: ['style', 'class'] });
  }

  global.Bocadillo = { crear, colocar };
})(typeof window !== 'undefined' ? window : globalThis);
