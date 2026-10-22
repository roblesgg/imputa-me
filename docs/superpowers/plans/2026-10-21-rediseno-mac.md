# Rediseño «Mac» de imputa.me (2.8.0)

Decidido con Álvaro en la sesión del 21/10/2026 (maquetas en `.superpowers/brainstorm/`).

## Estilo (decidido)

- **Modo oscuro principal: «Noche cálida»** — negro cálido con brillos naranja y ciruela. Modo claro
  **«Luz»** (cristal blanco sobre pastel melocotón/lila/menta) como alternativa. Los temas viejos se
  conservan, pero el tema por defecto pasa a ser `noche` y en la primera ejecución de la 2.8 se cambia
  una vez (migración `uiVersion`).
- **Formas y botones «Suave»**: sin bordes ni cajas; campos como huecos translúcidos; cápsulas
  (botones, chips, filas seleccionadas); la tarea elegida se tiñe con su propio color; botón principal
  naranja tonal (no sólido); «Cancelar» como texto; horas grandes.
- **Tipografía**: Inter (incluida en `assets/fonts`, licencia OFL).
- **Líneas** finísimas; brillo en el canto del cristal; línea de «ahora» naranja; la tarea en marcha late.

## Cristal líquido (decidido: Liquid Glass Studio, MIT, © iyinchao)

Sombreadores WebGL2 portados de github.com/iyinchao/liquid-glass-studio (paso final STEP 9), con los
valores elegidos por Álvaro:

| parámetro | valor |
|---|---|
| refDistance | 0.11 |
| refThickness | 29 px |
| refFactor (índice) | 1.62 |
| refDispersion | 0 (sin arcoíris) |
| blur | 30.5 px |
| tinte | oscuro cálido (30,26,30) al 0.25 (en «Luz»: blanco) |
| Fresnel alcance / dureza / fuerza | 30 / 0 / 0.34 |
| brillo (glare) | fuerza 0 (apagado), alcance 30, dureza 0.2, ángulo −40° |
| radio esquinas | 80 px (superelipse n=5) |

- Dobla una **captura** del fondo: al abrir un bocadillo se pide `capturePage()` de la propia
  ventana (en el dock, de la región del iframe) y el cristal se pinta sobre esa imagen.
- Solo en **bocadillos, menús y menú circular**. Superficies grandes: esmerilado normal.
- Sin GPU (WebGL2 ausente o SwiftShader) → esmerilado.
- **Punta del bocadillo**: gotita de cristal fundida con el bocadillo (smin de una esfera con el
  rectángulo, como las gotas de Liquid Glass Studio).

## Calendario

- **Clic** en un bloque: lo selecciona (no abre nada). **Doble clic**: abre el detalle.
- **Clic en un hueco**: deja ahí el cursor de pegado (marca naranja). **Arrastrar**: crea entrada.
  **Doble clic en un hueco**: nueva entrada de 30 min.
- **Ctrl+C / Ctrl+V** copia y pega en el cursor (o donde esté el ratón). **Ctrl+D** duplica,
  **Supr** elimina (con confirmación), **Intro** abre el detalle, **Esc** quita la selección.
- **Clic derecho**: menú circular animado (cristal) — Detalles, Copiar, Duplicar, Pausar / Retomar
  desde ahora / Alargar hasta ahora, Sección (anillo secundario), Color (anillo de colores),
  Eliminar. En un hueco: Nueva entrada aquí, Pegar aquí, Empezar tarea.
- Rediseño de los bocadillos «Nueva entrada» y «detalle de entrada».

## Categorías (secciones) con paleta

- Cada sección puede tener una paleta (azules, rojos, verdes, ámbar, violetas, rosas, turquesas,
  grises). Una tarea nueva de esa sección recibe un color al azar de su paleta (evitando repetir el
  último). Opción «Repintar sus tareas» en la sección.

## Transiciones del panel lateral (dock)

- Las cuatro vistas se cargan una vez y se quedan vivas (un iframe por vista): cambiar de pestaña no
  recarga nada → fundido y desplazamiento suaves, sin trozos en blanco.
- Cuando cambia el ancho (calendario): la ventana se desvanece, cambia de tamaño invisible y vuelve
  a aparecer con la vista nueva ya pintada (nada de redimensionar a la vista).

## Tareas

- [ ] 1. Base: Inter, tokens Noche cálida / Luz, componentes Suave en `shared.css`; temas en `main.js`
- [ ] 2. Cristal líquido: `src/glass.js` (WebGL2 LGS) + captura en `main.js`
- [ ] 3. Calendario: selección/copiar/pegar/cursor/teclado; doble clic; menú circular
- [ ] 4. Calendario: bocadillos nuevos (nueva entrada / detalle) con cristal y gotita
- [ ] 5. Secciones con paleta (datos + Tareas + color al crear)
- [ ] 6. Dock: vistas precargadas y transiciones sin blancos
- [ ] 7. Repaso de Panel, Tareas, Ajustes, recordatorio, barrita y ventanas sueltas
- [ ] 8. Comprobaciones (`node check-all.js`), capturas offscreen, versión 2.8.0 e instalador local
