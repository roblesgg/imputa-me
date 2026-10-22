/**
 * Menú circular (2.8): el clic derecho del calendario.
 *
 *   RadialMenu.open({ x, y, title, subtitle, color, items, onClose })
 *     items: [{ id, label, hint, icon, tone, disabled, selected, color, run(), sub }]
 *       tone: 'danger' | 'success' | 'accent' (opcional)
 *       sub:  { title, subtitle, items, kind } o una función que lo devuelva
 *             kind 'swatches' → un segundo anillo de colores
 *             kind 'list'     → una lista de cristal al lado del disco (secciones…)
 *   RadialMenu.close() · RadialMenu.isOpen()
 *
 * El fondo es un disco de cristal líquido (glass.js) que dobla la rejilla de debajo; sin
 * WebGL se queda esmerilado. Se elige apuntando: basta con mover el ratón hacia una opción
 * (no hace falta acertar en el botón) y hacer clic. También con flechas, Intro y Esc.
 */
(function (global) {
  'use strict';

  const R = 78;          // radio del anillo donde van los botones
  const ITEM = 46;       // tamaño de cada botón
  const CENTRO = 52;     // radio del círculo central (el que muestra el nombre)
  const MARGEN = 14;
  const D = 2 * (R + ITEM / 2 + MARGEN);   // diámetro del disco
  const LISTA_W = 230;

  let actual = null;     // el menú abierto

  function isOpen() { return !!actual; }

  function close(inmediato) {
    const m = actual;
    if (!m) return Promise.resolve();
    actual = null;
    document.removeEventListener('keydown', m.onKey, true);
    window.removeEventListener('blur', m.onBlur);
    m.root.classList.add('saliendo');
    m.root.classList.remove('abierto');
    const quitar = () => {
      if (m.glass) m.glass.detach();
      if (m.listaGlass) m.listaGlass.detach();
      m.root.remove(); m.catcher.remove();
      if (m.onClose) m.onClose();
    };
    if (inmediato) { quitar(); return Promise.resolve(); }
    return Promise.all([
      m.glass ? m.glass.salir(170) : Promise.resolve(),
      m.listaGlass ? m.listaGlass.salir(140) : Promise.resolve(),
      new Promise((r) => setTimeout(r, 170)),
    ]).then(quitar);
  }

  // Ángulo de cada opción: empezando arriba y en el sentido de las agujas del reloj.
  function angulo(i, n) { return -Math.PI / 2 + (i * 2 * Math.PI) / n; }

  function pintarCentro(m, texto, sub, color) {
    const c = m.centro;
    c.classList.remove('cambia');
    void c.offsetWidth;
    c.classList.add('cambia');
    const dot = c.querySelector('.rm-c-dot');
    dot.style.background = color || 'transparent';
    dot.style.display = color ? '' : 'none';
    c.querySelector('.rm-c-t').textContent = texto || '';
    c.querySelector('.rm-c-s').textContent = sub || '';
  }

  function resaltar(m, idx) {
    if (m.hover === idx) return;
    m.hover = idx;
    m.layer.querySelectorAll('.rm-item').forEach((b, i) => b.classList.toggle('hot', i === idx));
    const it = idx >= 0 ? m.items[idx] : null;
    if (it) {
      const a = angulo(idx, m.items.length) * 180 / Math.PI + 90;
      // El indicador gira por el camino corto (sin dar la vuelta entera de 350° a 10°).
      let delta = a - m.indAng;
      delta = ((delta % 360) + 540) % 360 - 180;
      m.indAng += delta;
      m.ind.style.transform = `rotate(${m.indAng}deg)`;
      m.ind.classList.add('on');
      m.ind.classList.toggle('danger', it.tone === 'danger');
      pintarCentro(m, it.label, it.hint || '', it.kind === 'swatch' ? it.color : null);
    } else {
      m.ind.classList.remove('on');
      pintarCentro(m, m.nivel.title, m.nivel.subtitle, m.nivel.color);
    }
  }

  // Coloca las opciones de un nivel: salen del centro con muelle, una detrás de otra.
  function pintarNivel(m, nivel) {
    m.nivel = nivel;
    m.items = nivel.items.filter(Boolean);
    m.hover = -2;
    m.layer.querySelectorAll('.rm-item').forEach((b) => b.remove());
    const n = m.items.length;
    const muestras = nivel.kind === 'swatches';
    const tam = muestras ? 26 : (n > 9 ? 38 : ITEM);
    m.items.forEach((it, i) => {
      if (muestras) it.kind = 'swatch';
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'rm-item' + (it.tone ? ' tone-' + it.tone : '') + (muestras ? ' swatch' : '') +
        (it.selected ? ' sel' : '') + (it.disabled ? ' off' : '');
      const a = angulo(i, n);
      b.style.setProperty('--x', (Math.cos(a) * R).toFixed(1) + 'px');
      b.style.setProperty('--y', (Math.sin(a) * R).toFixed(1) + 'px');
      b.style.setProperty('--s', tam + 'px');
      b.style.setProperty('--d', (i * (muestras ? 12 : 22)) + 'ms');
      if (it.color) b.style.setProperty('--c', it.color);
      b.innerHTML = muestras ? '' : (it.icon || '');
      b.setAttribute('aria-label', it.label);
      b.addEventListener('pointerenter', () => resaltar(m, i));
      b.addEventListener('click', (e) => { e.stopPropagation(); elegir(m, i); });
      m.layer.appendChild(b);
    });
    m.root.classList.toggle('con-atras', !!m.pila.length);
    resaltar(m, -1);
    requestAnimationFrame(() => requestAnimationFrame(() => { if (actual === m) m.layer.classList.add('fuera'); }));
  }

  function cambiarNivel(m, nivel) {
    cerrarLista(m);
    m.layer.classList.remove('fuera');
    setTimeout(() => { if (actual === m) pintarNivel(m, nivel); }, 150);
  }

  function elegir(m, i) {
    const it = m.items[i];
    if (!it || it.disabled) return;
    if (it.sub) {
      const sub = typeof it.sub === 'function' ? it.sub() : it.sub;
      if (sub.kind === 'list') { abrirLista(m, sub, i); return; }
      m.pila.push(m.nivel);
      cambiarNivel(m, Object.assign({ color: m.nivel.color }, sub));
      return;
    }
    ejecutar(it);
  }

  function ejecutar(it) {
    close().then(() => { try { it.run && it.run(); } catch (e) { console.warn('[radial]', e); } });
  }

  function atras(m) {
    if (m.lista) { cerrarLista(m); return; }
    if (!m.pila.length) { close(); return; }
    cambiarNivel(m, m.pila.pop());
  }

  // ── Lista lateral (secciones) ─────────────────────────────────────────────────
  async function abrirLista(m, sub, desde) {
    cerrarLista(m);
    const lista = document.createElement('div');
    lista.className = 'rm-lista';
    // A la derecha del disco si cabe; si no, a la izquierda.
    const caja = m.root.getBoundingClientRect();
    const derecha = caja.right + 10 + LISTA_W < window.innerWidth - 6;
    lista.classList.add(derecha ? 'a-derecha' : 'a-izquierda');
    lista.style.width = LISTA_W + 'px';
    const cuerpo = document.createElement('div');
    cuerpo.className = 'rm-lista-cuerpo';
    if (sub.title) {
      const t = document.createElement('div');
      t.className = 'rm-lista-titulo';
      t.textContent = sub.title;
      cuerpo.appendChild(t);
    }
    sub.items.filter(Boolean).forEach((it, i) => {
      if (it.separator) { const s = document.createElement('div'); s.className = 'rm-lista-sep'; cuerpo.appendChild(s); return; }
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'rm-lista-item' + (it.selected ? ' sel' : '') + (it.tone ? ' tone-' + it.tone : '');
      b.style.setProperty('--d', (i * 18) + 'ms');
      b.innerHTML = `<span class="rm-li-dot"></span><span class="rm-li-t"></span><span class="rm-li-check"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5L20 7"/></svg></span>`;
      const dot = b.querySelector('.rm-li-dot');
      if (it.color) dot.style.background = it.color; else if (it.icon) { dot.innerHTML = it.icon; dot.classList.add('icono'); } else dot.style.display = 'none';
      b.querySelector('.rm-li-t').textContent = it.label;
      b.addEventListener('click', (e) => { e.stopPropagation(); ejecutar(it); });
      cuerpo.appendChild(b);
    });
    lista.appendChild(cuerpo);
    lista.addEventListener('pointermove', (e) => e.stopPropagation());
    lista.addEventListener('click', (e) => e.stopPropagation());
    m.root.appendChild(lista);
    m.lista = lista;
    m.listaDesde = desde;
    m.layer.querySelectorAll('.rm-item').forEach((b, i) => b.classList.toggle('abierta', i === desde));
    // Centrada en vertical respecto al disco, sin salirse de la ventana.
    const h = lista.offsetHeight;
    const topAbs = Math.max(6, Math.min(window.innerHeight - h - 6, caja.top + caja.height / 2 - h / 2));
    lista.style.top = (topAbs - caja.top) + 'px';
    lista.classList.add('preparando');
    const g = global.LiquidGlass ? await global.LiquidGlass.attach(lista, {}) : null;
    if (m.lista !== lista) { if (g) g.detach(); return; }
    m.listaGlass = g;
    lista.classList.remove('preparando');
    if (g) g.entrar(380);
    lista.classList.add('abierta');
  }

  function cerrarLista(m) {
    if (!m.lista) return;
    const l = m.lista, g = m.listaGlass;
    m.lista = null; m.listaGlass = null;
    m.layer.querySelectorAll('.rm-item.abierta').forEach((b) => b.classList.remove('abierta'));
    l.classList.remove('abierta');
    l.classList.add('saliendo');
    (g ? g.salir(140) : new Promise((r) => setTimeout(r, 140))).then(() => { if (g) g.detach(); l.remove(); });
  }

  async function open(opts) {
    await close(true);
    const vw = window.innerWidth, vh = window.innerHeight;
    const cx = Math.max(D / 2 + 6, Math.min(vw - D / 2 - 6, opts.x));
    const cy = Math.max(D / 2 + 6, Math.min(vh - D / 2 - 6, opts.y));

    const catcher = document.createElement('div');
    catcher.className = 'rm-catcher';
    const root = document.createElement('div');
    root.className = 'rm';
    root.style.left = (cx - D / 2) + 'px';
    root.style.top = (cy - D / 2) + 'px';
    root.style.setProperty('--D', D + 'px');
    root.style.setProperty('--C', (CENTRO * 2) + 'px');
    root.innerHTML = `
      <div class="rm-disc"></div>
      <div class="rm-layer">
        <svg class="rm-ind" viewBox="0 0 ${D} ${D}" width="${D}" height="${D}" aria-hidden="true">
          <path d="${arco(D / 2, D / 2, R + ITEM / 2 + 6, -19, 19)}" />
        </svg>
        <button type="button" class="rm-centro" aria-label="Volver">
          <span class="rm-c-back"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg></span>
          <span class="rm-c-dot"></span>
          <span class="rm-c-t"></span>
          <span class="rm-c-s"></span>
        </button>
      </div>`;
    document.body.appendChild(catcher);
    document.body.appendChild(root);

    const m = {
      root, catcher, onClose: opts.onClose,
      layer: root.querySelector('.rm-layer'),
      disc: root.querySelector('.rm-disc'),
      ind: root.querySelector('.rm-ind'),
      centro: root.querySelector('.rm-centro'),
      pila: [], hover: -2, indAng: 0, items: [], glass: null, lista: null, listaGlass: null,
    };
    actual = m;

    // Apuntar: la opción que queda en la dirección del ratón (fuera del círculo central).
    root.addEventListener('pointermove', (e) => {
      if (m.lista) return;
      const dx = e.clientX - cx, dy = e.clientY - cy;
      if (Math.hypot(dx, dy) < CENTRO - 4 || !m.items.length) { resaltar(m, -1); return; }
      let a = Math.atan2(dy, dx) + Math.PI / 2;
      if (a < 0) a += 2 * Math.PI;
      const n = m.items.length;
      const i = Math.round(a / (2 * Math.PI / n)) % n;
      resaltar(m, m.items[i] && !m.items[i].disabled ? i : -1);
    });
    root.addEventListener('click', (e) => {
      if (e.target.closest('.rm-centro')) { atras(m); return; }
      if (m.lista) { cerrarLista(m); return; }
      if (m.hover >= 0) elegir(m, m.hover);
    });
    root.addEventListener('contextmenu', (e) => e.preventDefault());
    catcher.addEventListener('pointerdown', (e) => { e.preventDefault(); close(); });
    catcher.addEventListener('contextmenu', (e) => e.preventDefault());
    catcher.addEventListener('wheel', () => close(), { passive: true });

    m.onKey = (e) => {
      if (actual !== m) return;
      const n = m.items.length;
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); atras(m); }
      else if (m.lista) return;
      else if (e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === 'Tab') {
        e.preventDefault(); e.stopPropagation();
        resaltar(m, ((m.hover < 0 ? -1 : m.hover) + 1) % n);
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        e.preventDefault(); e.stopPropagation();
        resaltar(m, ((m.hover < 0 ? 0 : m.hover) - 1 + n) % n);
      } else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault(); e.stopPropagation();
        if (m.hover >= 0) elegir(m, m.hover);
      }
    };
    document.addEventListener('keydown', m.onKey, true);
    m.onBlur = () => close(true);
    window.addEventListener('blur', m.onBlur);

    // Cristal: un círculo exacto (superelipse con n = 2). Si no hay, se queda esmerilado.
    root.classList.add('preparando');
    const g = global.LiquidGlass ? await global.LiquidGlass.attach(m.disc, { roundness: 2, radius: D / 2 }) : null;
    if (actual !== m) { if (g) g.detach(); return; }
    m.glass = g;
    pintarNivel(m, { title: opts.title, subtitle: opts.subtitle, color: opts.color, items: opts.items });
    if (g) g.entrar(480);
    root.classList.remove('preparando');
    root.classList.add('abierto');
  }

  // Trozo de anillo (para el indicador que señala la opción elegida).
  function arco(cx, cy, r, a0, a1) {
    const p = (a) => [cx + r * Math.cos((a - 90) * Math.PI / 180), cy + r * Math.sin((a - 90) * Math.PI / 180)];
    const [x0, y0] = p(a0), [x1, y1] = p(a1);
    return `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${r} ${r} 0 0 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
  }

  global.RadialMenu = { open, close, isOpen };
})(typeof window !== 'undefined' ? window : globalThis);
