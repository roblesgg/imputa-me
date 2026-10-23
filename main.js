const { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage, screen, dialog, nativeTheme, Notification, desktopCapturer } = require('electron');
const path = require('path');
const fs = require('fs');

// Instancia única: sin esto, cada vez que se relanzaba la app (acceso directo, inicio con
// Windows, doble clic...) mientras ya había una corriendo, se abría un PROCESO NUEVO entero
// -con su propio icono de bandeja y su propio panel- en vez de traer al frente el que ya
// estaba abierto. De ahí que a veces aparecieran dos paneles a la vez.
if (!app.requestSingleInstanceLock()) {
  app.quit();
  return;
}
app.on('second-instance', () => {
  // Alguien ha vuelto a lanzar la app mientras ya estaba corriendo: solo la traemos al
  // frente (por donde se quedó), no dejamos que se abra un proceso duplicado.
  openLastView();
});

const APP_ICON_PATH = path.join(__dirname, 'assets', 'icon.png');
// Para las ventanas, el .ico (16-256 px): el PNG es de 2000×2000 y se decodificaba
// entero (~16 MB) cada vez que se creaba una ventana, como el recordatorio.
const WINDOW_ICON_PATH = path.join(__dirname, 'assets', 'icon.ico');
const TASK_COLORS = ['#6366f1','#f472b6','#34d399','#fbbf24','#60a5fa','#f87171','#a78bfa','#2dd4bf'];
// ── Temas de color ───────────────────────────────────────────────────────────
// Los temas, los acentos y la paleta resuelta viven en themes.js (también los usan las
// herramientas de captura de tools/).
const { THEMES, DEFAULT_THEME, ACCENTS, themeVars: resolverTema } = require('./themes');
const { aplicarDesenfoqueWindows, quitarDesenfoqueWindows, esquinasWindows } = require('./desenfoque-windows');
const { vigilarCapturas } = require('./capturas-windows');
const USAR_DESENFOQUE_SISTEMA = false;
const { GROUP_PALETTES, colorFromGroupPalette } = require('./palettes');
// Versión de la interfaz: la 3 es el rediseño de la 2.8 (Noche cálida). Al pasar a ella se
// estrena el tema nuevo una vez; después cada cual elige el que quiera en Ajustes.
const UI_VERSION = 5;

// Recorrido de novedades que se muestra UNA vez al actualizar. Solo para quien va por el
// canal estable: en el de prueba las versiones se suceden a diario y sería un incordio.
// Un mismo recorrido puede valer para varias versiones (2.2.1 solo arreglaba que este
// no llegara a salir), y por eso se comparte el objeto: así se detecta que ya se ha
// visto y no se repite palabra por palabra en la siguiente actualización.
const NOVEDADES_2_2 = {
  title: 'Novedades de imputa.me 2.2',
  steps: [
    { icon:'cursor', title:'Se acabó el parpadeo del cursor',
      text:'Al pasar el ratón por botones, campos y agarradores el cursor se quedaba parpadeando entre la flecha y la mano. Ya no: ahora se mantiene estable mientras mueves el ratón.' },
    { icon:'calendar', title:'Las tareas ya no se pisan',
      text:'Al estirar una tarea por sus extremos en el calendario, ahora hace tope justo donde llega la de al lado. Si la arrastras a fondo, una acaba exactamente cuando empieza la otra.' },
    { icon:'calendar', title:'Horas legibles en cada tarea',
      text:'La duración baja a su propia línea, así que la hora de inicio y la de fin se leen enteras sin cortarse.' },
    { icon:'screen', title:'Mejor con varios monitores',
      text:'Al esconder el panel flotante ya no asoma un instante en la pantalla de al lado: ahora entra y sale con un desvanecido sin salir nunca de su monitor.' },
    { icon:'spark', title:'Se esconde a tu ritmo',
      text:'Si usas "esconder cuando el ratón sale", puedes ajustar el retardo en medios segundos, e incluso ponerlo a cero para que se esconda al instante.' },
    { icon:'bell', title:'Actualizaciones sin sorpresas',
      text:'Cuando haya una versión nueva te avisa sola con una notificación, pero no se descarga ni se instala nada sin que tú lo decidas.' },
    { icon:'spark', title:'Esto que estás viendo',
      text:'A partir de ahora, cada versión estable te recibe con un recorrido como este. Puedes repasarlo cuando quieras desde Ajustes → Ver novedades.' },
  ],
};

const NOVEDADES_2_3 = {
  title: 'Novedades de imputa.me 2.3',
  steps: [
    { icon:'bar', title:'La barra flotante ya no se pierde',
      text:'Se quedaba sin aparecer al encender el ordenador, y con varios monitores podía acabar plantada en medio de la pantalla. Ahora se recoloca sola al arrancar, cuando conectas o desconectas pantallas, y vuelve siempre a su sitio al cerrar el panel.' },
    { icon:'cursor', title:'Se enciende cuando estás al lado',
      text:'Antes se iluminaba desde bastante lejos. Ahora reacciona con el ratón ya pegado, y en Ajustes → Barra flotante puedes decidir a qué distancia exacta se enciende.' },
    { icon:'spark', title:'Se mueve con suavidad',
      text:'El panel iba a trompicones al abrirse y al cambiar de pestaña porque se le animaba el tamaño paso a paso. Ahora entra y sale con un desvanecido limpio.' },
    { icon:'screen', title:'Arrastrar ya no se queda pegado',
      text:'Si al agrandar el panel soltabas el ratón fuera de la ventana, se quedaba enganchado como si siguieras pulsando hasta hacer clic en otro sitio. Arreglado, también al mover la barrita.' },
    { icon:'guide', title:'El tutorial te lleva de la mano',
      text:'Ahora es un recorrido guiado: empieza en el Panel y te lleva solo al Calendario, a Guardadas y a Ajustes. Tú solo le das a Siguiente. Además arranca en el momento de pulsarlo, y en las páginas largas se desplaza sola hasta lo que te está explicando.' },
    { icon:'pencil', title:'Renombrar con un clic',
      text:'Cada tarea del Panel y cada sección de Guardadas tiene su lápiz al lado del botón de borrar. Ya no hay que adivinar que era doble clic (que sigue funcionando).' },
    { icon:'folder', title:'Ordena tus secciones',
      text:'En Guardadas hay un botón nuevo para ordenar las secciones: alfabéticamente, por orden de creación, o a tu manera arrastrándolas por su asa. Tu orden se guarda.' },
  ],
};

const NOVEDADES_2_4 = {
  title: 'Novedades de imputa.me 2.4',
  steps: [
    { icon:'lista', title:'Subtareas',
      text:'Dentro de una tarea puedes crear subtareas: en "Cocina", el horno y el frigorífico. La flechita de cada tarea del Panel las despliega, cada una lleva su propio tiempo y su play, y todo lo que hagas dentro suma en la tarea. Sus notas van como siempre, una por sesión.' },
    { icon:'spark', title:'El Panel, reorganizado',
      text:'Lo que estás haciendo ahora ocupa el sitio de honor: una tarjeta grande con su cronómetro, su nota y el botón de pausar. El total del día baja a una línea fina y la lista de abajo ya no repite la tarea que está arriba.' },
    { icon:'guide', title:'Accesos rápidos',
      text:'Bajo la lista de tareas tienes cuatro botones: Calendario, Guardadas, Ajustes, y uno que vuelve a poner en marcha la última tarea que estuviste haciendo, con su nombre puesto.' },
    { icon:'enlace', title:'Botón para imputar',
      text:'En Ajustes → Enlace para imputar pega la dirección del sitio donde metes las horas de verdad. Aparecerá un botón "Imputar" en el Panel y en el Calendario que te lleva ahí de un clic.' },
    { icon:'reloj', title:'Hora de salida',
      text:'Dile a qué hora terminas y, si a esa hora sigue habiendo una tarea en marcha, te aviso. La misma hora toda la semana o una distinta cada día, con los que no trabajes cancelados. Y si quieres, que te la pare yo sola.' },
    { icon:'ojo', title:'Descansa la vista',
      text:'La regla 20-20-20 que recomiendan los oftalmólogos: cada 20 minutos, mira 20 segundos a algo que esté a unos 6 metros. Salen unos ojos flotantes con la cuenta atrás; eliges cada cuánto, cuánto duran, dónde y de qué tamaño, y un clic los quita hasta la próxima.' },
    { icon:'calendar', title:'Tu semana y tu mes',
      text:'En el calendario, debajo de las tareas del día están ahora las de la semana y las del mes, cada bloque con el tiempo de cada tarea y su total. Y en cada rato puedes elegir a qué subtarea fue.' },
    { icon:'screen', title:'La barra y tus monitores',
      text:'Si desconectas la pantalla donde tenías la barra flotante, se pasa sola a la que quede, y al volver a conectarla se va otra vez a ella. La reconoce por sus medidas, porque Windows le cambia el identificador al reconectarla.' },
  ],
};

// La 2.4 contaba las novedades y ya: un resumen leído, sin enseñar dónde estaba nada.
// Este es corto a propósito, porque lo que explica de verdad viene después: el
// recorrido guiado, que va señalando cada cosa en su sitio.
const NOVEDADES_2_4_1 = {
  title: 'Novedades de imputa.me 2.4',
  steps: [
    { icon:'guide', title:'Ahora te lo enseño, no te lo cuento',
      text:'Hasta ahora las novedades eran una presentación que leías y cerrabas, y luego tocaba buscarse la vida. A partir de aquí, el recorrido va por la app señalando cada cosa nueva en el sitio donde está.' },
    { icon:'lista', title:'Lo que trae la 2.4',
      text:'Subtareas dentro de cada tarea, el Panel reorganizado con lo que estás haciendo en grande, accesos rápidos, hora de salida, la regla 20-20-20 para descansar la vista, un botón para imputar y los totales de semana y mes en el calendario.' },
    { icon:'spark', title:'Tú solo dale a Siguiente',
      text:'El recorrido empieza en el Panel y te lleva solo al Calendario, a Guardadas y a Ajustes. Solo verás lo que sea nuevo para ti, y puedes dejarlo a medias cuando quieras: lo visto queda visto. Lo tienes siempre en Ajustes → Ver tutorial.' },
  ],
};

const NOVEDADES_2_5 = {
  title: 'Novedades de imputa.me 2.5',
  steps: [
    { icon:'guide', title:'Te lo enseño donde está',
      text:'Como en la 2.4: cuando acabes de leer esto, el recorrido te lleva por la app señalando cada cosa nueva en su sitio. Solo verás lo que no hayas visto ya, y con darle a Siguiente basta.' },
    { icon:'bell', title:'No molestar',
      text:'Silencia de golpe todo lo que sale por encima: el recordatorio de las horas, los ojos del 20-20-20 y las notificaciones. Los minutos u horas que quieras, y los cronómetros siguen contando igual.' },
    { icon:'bar', title:'La barra, con su menú',
      text:'Clic derecho sobre la barra flotante: esconderla un rato, cambiarla de pantalla o de borde, pausar la tarea, o pasarte al modo clásico de ventanas. Y ya no se queda detrás de lo que pongas a pantalla completa.' },
    { icon:'folder', title:'Guardadas, como un esquema',
      text:'Cada tarea guardada despliega sus subtareas con el tiempo que llevan, y pulsando una retomas la tarea justo en ella. Con botones para abrirlo y cerrarlo todo, y ordenado ascendente o descendente.' },
    { icon:'calendar', title:'Los días que trabajas',
      text:'Quita el sábado y el domingo del calendario y las columnas se reparten el hueco. Y si una semana suelta sí trabajas un sábado, lo metes solo en esa semana desde el botón "Días".' },
    { icon:'pencil', title:'Clic derecho en el calendario',
      text:'Sobre cualquier rato del calendario: guardar la tarea en una sección, retomarla desde ahora o alargar ese rato hasta ahora — conservando su subtarea y su nota — y editarlo o eliminarlo.' },
    { icon:'lista', title:'"Guardadas" ahora es "Tareas"',
      text:'Y ya no es solo el archivo: están todas tus tareas, con las que no tienen sección agrupadas al principio. Cada una con su play, su papelera y su color, y la que esté corriendo resaltada con su punto latiendo. Borrar una la manda a la papelera y NO toca el calendario: lo que registraste sigue ahí.' },
    { icon:'guide', title:'El Panel, solo lo reciente',
      text:'Como todas viven en Tareas, el Panel enseña únicamente las que has usado hace poco, la última arriba, con un "ver todas" al lado cuando hay más.' },
    { icon:'spark', title:'Y por debajo',
      text:'24 colores de tarea en vez de 8, animaciones bastante más fluidas, el panel flotante se adapta de tamaño con animación al cambiar de pestaña, los ojos avisan cuando toca de verdad, y el instalador ya no te pide cerrar la app a mano al actualizar.' },
  ],
};

const NOVEDADES_2_8 = {
  title: 'Novedades de imputa.me 2.8',
  steps: [
    { icon:'guide', title:'Te lo enseño en su sitio',
      text:'Cuando acabes de leer esto, el recorrido te lleva por el calendario, Tareas y Ajustes señalando cada cosa nueva donde está. Solo verás lo que no hayas visto ya.' },
    { icon:'spark', title:'Cara nueva',
      text:'Toda la app rediseñada con estilo Mac: el tema Noche cálida (y Luz, el claro), letra nueva, cápsulas en vez de cajas y animaciones con muelle. Al cambiar de pestaña ya no quedan trozos en blanco.' },
    { icon:'calendar', title:'El calendario, a mano',
      text:'Un clic selecciona un rato (ya no lo abre); doble clic o Intro abre sus detalles. Ctrl+C lo copia, haces clic donde quieras y Ctrl+V lo pega ahí, viendo antes dónde va a quedar. Ctrl+D lo duplica y Supr lo borra.' },
    { icon:'pencil', title:'Menú circular',
      text:'Clic derecho sobre un rato: detalles, pausar o seguir, alargar hasta ahora, copiar, duplicar, color, sección y eliminar, en una rueda de cristal. Basta con mover el ratón hacia la opción. En un hueco: entrada nueva, pegar o empezar una tarea.' },
    { icon:'guide', title:'Bocadillos de cristal',
      text:'"Nueva entrada" y los detalles de un rato salen al lado del bloque, apuntándole, con cristal líquido que dobla lo que hay detrás. Si lo prefieres esmerilado, se apaga en Ajustes → Apariencia.' },
    { icon:'folder', title:'Colores por sección',
      text:'En Tareas, el botón de paleta de cada sección le da unos tonos (azules, verdes, naranjas…): cada tarea nueva de esa sección coge uno al azar. Con "Repintar" se los das también a las que ya tiene.' },
  ],
};

const NOVEDADES_2_8_3 = {
  title: 'Novedades de imputa.me 2.8.3',
  steps: [
    { icon:'spark', title:'Ajustes, de un vistazo',
      text:'Cada opción con su icono y una línea, no un párrafo. Arriba, tu app en pequeño cambia de color según tocas; la barra flotante y el descanso visual se ven en una pantallita.' },
    { icon:'guide', title:'Siete temas nuevos y más acentos',
      text:'Aurora, Medianoche, Atardecer y Musgo (oscuros), Lavanda, Menta y Arena (claros), todos con sus brillos. Y el doble de colores de acento.' },
    { icon:'bell', title:'El recordatorio, de cristal',
      text:'El aviso de la esquina brota del borde de la pantalla como una gota, se abre en su sitio y, al irse, vuelve a meterse por donde vino.' },
    { icon:'bar', title:'Panel lateral de cristal',
      text:'Sube "Transparencia del panel" en Ajustes y el panel lateral pasa a ser de cristal líquido. Con "Difuminar el fondo" eliges si va esmerilado o claro.' },
    { icon:'pencil', title:'Ctrl+Z y Ctrl+Y',
      text:'Deshaz y rehaz cualquier cambio en tareas, ratos del calendario o secciones. Y en el calendario: arrastrar un rato lo vuelve de cristal, clic en "pegar aquí" pega, y clic derecho en una tarea de la izquierda la inicia.' },
    { icon:'lista', title:'Tareas, como el Panel',
      text:'Cada tarea es una píldora: el lápiz y la papelera asoman al pasar el ratón, y la que está en marcha se resalta igual que en el Panel.' },
    { icon:'calendar', title:'Detalles pulidos',
      text:'Las listas se desvanecen por los bordes al hacer scroll en vez de cortarse en seco, la tarea en marcha del calendario va en una píldora, y en modo ventana ya no se duplica el texto al bajar por Ajustes.' },
  ],
};

const WHATS_NEW = {
  '2.8.4': { ...NOVEDADES_2_8_3, title: 'Novedades de imputa.me 2.8.4' },
  '2.8.3': NOVEDADES_2_8_3,
  '2.8.0': NOVEDADES_2_8,
  '2.8.1': NOVEDADES_2_8,
  '2.8.2': NOVEDADES_2_8,
  '2.2.0': NOVEDADES_2_2,
  '2.2.1': NOVEDADES_2_2,
  '2.3.0': NOVEDADES_2_3,
  '2.4.0': NOVEDADES_2_4,
  '2.4.1': NOVEDADES_2_4_1,
  '2.5.0': NOVEDADES_2_5,
  // Mismas novedades para toda la serie 2.5: sin esto, quien viniera de la 2.4 y cayera
  // directamente en una 2.5.x posterior no veía nada. El guardarraíl de repetición vive
  // en otro sitio (lastSeenWhatsNew compara de qué hablaba lo último que se enseñó).
  '2.5.1': NOVEDADES_2_5,
  '2.5.2': NOVEDADES_2_5,
  '2.5.3': NOVEDADES_2_5,
  '2.5.4': NOVEDADES_2_5,
  '2.5.5': NOVEDADES_2_5,
  '2.5.6': NOVEDADES_2_5,
};

const TRASH_RETENTION_DAYS = 30;   // cuánto tiempo se puede restaurar una tarea desde la papelera
const TRASH_RETENTION_MS = TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000;

// ¿Está esta tarea ahora mismo en la papelera? (borrada, no eliminada del todo y aún
// dentro del plazo de restauración).
function isInTrash(t) {
  return t.deleted && !t.purged && t.deletedAt && (Date.now() - t.deletedAt < TRASH_RETENTION_MS);
}

// ── Archivador ────────────────────────────────────────────────────────────────
// Última vez que se usó la tarea: la entrada más reciente (start o end), o si nunca
// se ha usado, el momento en que se creó (el id ES esa marca de tiempo: Date.now()
// al crearla, igual que en el resto de la app).
function lastUsedMs(t) {
  let max = Number(t.id) || 0;
  (t.entries || []).forEach(e => {
    if (e.start > max) max = e.start;
    if (e.end && e.end > max) max = e.end;
  });
  return max;
}

// ¿Lleva esta tarea sin tocarse más de lo que marcan los ajustes? La que está en
// marcha ahora mismo nunca cuenta, y con archiveDays a 0 el archivador queda apagado.
function isInactiveTask(t) {
  if (t.deleted) return false;
  if (state.activeTaskId === t.id) return false;
  const days = Number(settings.archiveDays) || 0;
  if (days <= 0) return false;
  return (Date.now() - lastUsedMs(t)) > days * 24 * 60 * 60 * 1000;
}

let DATA_FILE;
let SETTINGS_FILE;

let tray = null;
let widgetWin = null;
let calendarWin = null;
let mainWin = null;
let settingsWin = null;
let groupsWin = null;
let splashWin = null;
let reminderTimer = null;
let leaveTimer = null;
let eyeCareWin = null;
let eyeCareTimer = null;
let eyeCareNextAt = 0;       // momento del próximo aviso de la regla 20-20-20
let eyeCareHideTimer = null;
let leaveNotifiedOn = null;   // 'YYYY-MM-DD' del último aviso, para no repetirlo
let tickTimer = null;
let syncWin = null;
let updateWin = null;
let whatsNewWin = null;
let dockWin = null;              // ventana transparente de la BARRITA (click-through)
let dockPanelWin = null;         // ventana del PANEL: sin transparencia y con acrílico
let dockExpanded = false;
// Recorrido guiado en marcha: encadena Panel → Calendario → Guardadas → Ajustes.
let tourActive = false;
const TOUR_ORDER = ['main', 'calendar', 'groups', 'settings'];
let dockHitRects = [];           // zonas "clicables" del dock, en coords de su ventana
let dockOutsideSince = 0;        // desde cuándo el cursor está fuera del panel desplegado
let lastBarRaiseAt = 0;          // para no reordenar ventanas en cada evento (ver 'set-dock-config')
let dockBarRect = null;          // rectángulo de la barrita, para saber si el ratón se acerca
let dockBarNear = null;
let dockHitTimer = null;
let dockIgnoring = null;
let pendingUpdateState = null;   // último estado enviado a la ventana de actualización
let updateInfo = null;           // { version } si hay una actualización disponible (para el botón del panel)
let syncStatus = { loggedIn: false, email: null };

// Módulo de sincronización opcional (Supabase). Si falla el require, la app sigue local.
let sync = null;
try { sync = require('./sync'); } catch {}

// ── Estado ──────────────────────────────────────────────────────────────────
let state = {
  tasks: [],           // { id, name, color, subtasks: [{id,name}], entries: [{start, end, subId, note}], archived, groupId, taskType, memo }
  groups: [],          // { id, name }
  activeTaskId: null,
  activeSubId: null,   // subtarea en marcha dentro de la tarea activa (null = la tarea a secas)
};

let settings = {
  reminderMinutes: 10,
  // Enlace a donde imputas de verdad las horas (el portal de tu empresa, una hoja...).
  // Si está puesto, aparece un botón "Imputar" en el Panel y en el Calendario.
  imputeUrl: '',      // se conserva por compatibilidad; al arrancar se vuelca a imputeUrls
  imputeUrls: [],     // quien imputa en varios sitios puede tener todos los que quiera
  // ── Hora de salida ──────────────────────────────────────────────────────────
  // Aviso al terminar la jornada para que no se quede una tarea corriendo toda la
  // noche. Viene apagado: la hora de salida es cosa de cada uno, no hay defecto que
  // valga para todos. Los días van por getDay(): 0 = domingo ... 6 = sábado, y null
  // significa "ese día no me avises".
  leaveEnabled: false,
  leaveSameEveryDay: true,      // una sola hora para toda la semana
  leaveTime: '18:00',
  leaveDays: { 1:'18:00', 2:'18:00', 3:'18:00', 4:'18:00', 5:'18:00', 6:null, 0:null },
  leaveAutoStop: false,   // además de avisar, parar sola la tarea que siga en marcha
  // ── Regla 20-20-20 ──────────────────────────────────────────────────────────
  // Cada 20 minutos, mirar 20 segundos a algo que esté a unos 6 metros. Apagada por
  // defecto: es un aviso que interrumpe, y eso se pide, no se impone.
  eyeCareEnabled: false,
  eyeCareEvery: 20,      // minutos entre avisos
  eyeCareRest: 20,       // segundos que dura la cuenta atrás
  eyeCarePos: 'top',     // topLeft | top | topRight | bottomLeft | bottom | bottomRight
  eyeCareSize: 150,      // ancho de la burbuja en px (el alto va en proporción)
  widgetAutoHide: true,
  widgetAutoHideSeconds: 10,
  widgetScale: 100,         // 2.8.3: tamaño del recordatorio de la esquina (en %)
  colorMode: 'auto', // 'auto' | 'manual'
  openAtLogin: false, // arrancar al iniciar sesión en Windows (desactivado por defecto)
  bgOpacity: 85,       // 100 = mate; por debajo, el panel lateral es de cristal (2.8.3: de serie, un toque)
  tutorialSeenSteps: [], // ids de pasos del tutorial guiado ya vistos u omitidos (ver TUTORIAL_STEPS en shared.js)
  groupSort: 'created',  // orden de las secciones en Guardadas: 'created' | 'alpha' | 'custom'
  groupSortDir: 'asc',   // y en qué sentido: 'asc' | 'desc'
  // Días que se ven en el calendario, por getDay() (0 = domingo ... 6 = sábado). Por
  // defecto la semana entera; quien no trabaje el fin de semana puede quitarlo y las
  // columnas se reparten el hueco.
  weekDays: [1, 2, 3, 4, 5, 6, 0],
  // Excepciones para UNA semana concreta: { 'AAAA-MM-DD del lunes': [días visibles] }.
  // Sirve para el sábado suelto que sí se trabaja sin cambiar el ajuste general.
  weekOverrides: {},
  dockMode: true,      // modo barra flotante lateral: es el modo por defecto (instalación nueva)
  dockDisplayId: null, // en qué pantalla se ancla el dock (null = la de referencia)
  dockDisplayKey: null, // huella de esa pantalla: al reconectarla Windows puede darle otro id
  dockHiddenUntil: 0,   // 0 = visible; -1 = escondida a mano; si no, marca de tiempo en la que vuelve
  dndUntil: 0,          // No molestar: 0 = apagado; -1 = hasta apagarlo; si no, cuándo se apaga solo
  theme: DEFAULT_THEME, // fondo/paleta base de toda la app (ver THEMES)
  accent: null,         // color de acento; null = el que trae el tema (ver ACCENTS)
  dockAnchor: 'right', // borde al que se pega la barrita: left | right | top | bottom
  dockBarWidth: 7,     // grosor de la barrita (px)
  dockBarLength: 110,  // largo de la barrita (px)
  dockBarPos: 50,      // posición a lo largo del borde, en % (0 = arriba/izq, 100 = abajo/der)
  dockBarOffset: 4,    // cuánto se despega del borde hacia el centro (px)
  dockNearDistance: 45, // a cuántos px del ratón se enciende la barrita (antes 110, fijo)
  dockBarOpacity: 30,  // opacidad de la barrita EN REPOSO (al acercar el ratón va al máximo)
  dockBarColor: '#ffffff',
  dockPanelWidth: 460,  // ancho del panel en las vistas normales (anclajes laterales)
  dockPanelHeight: 620, // alto del panel cuando se ancla arriba/abajo (más generoso: hay ancho de sobra)
  dockCloseMode: 'button',  // 'button' | 'clickOutside' | 'mouseLeave'
  dockCloseSeconds: 3,      // con 'mouseLeave', segundos fuera antes de esconderse (admite decimales y 0)
  blurEnabled: true,        // difuminado del fondo (acrílico de Windows) sí/no
  // Canal de actualizaciones. Con betaUpdates, llegan TODAS las versiones que se publican
  // (las de prueba van marcadas como "prerelease" en GitHub); sin él, solo las marcadas
  // como estables.
  betaUpdates: false,
  lastSeenVersion: null,    // última versión cuyas novedades ya se han visto
  lastSeenWhatsNew: null,   // y de qué hablaban, para no repetir el mismo recorrido
  dockCalendarWidth: 1180, // el calendario se abre bastante más ancho (y se puede estirar)
  lastView: 'panel',    // última vista abierta: la app vuelve a abrirse por donde la dejaste
  archiveDays: 30,      // días sin usar una tarea antes de que pase al Archivador (0 = nunca)
  uiVersion: 0,         // versión de la interfaz ya estrenada (ver UI_VERSION)
};

function nextAutoColor() {
  return TASK_COLORS[state.tasks.length % TASK_COLORS.length];
}

function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) state = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch {
    // Fichero corrupto (p. ej. un apagado a mitad de escritura con el guardado de antes).
    // Antes se seguía con el estado vacío y el siguiente guardado machacaba TODO el
    // historial. Ahora se aparta una copia intacta y se prueba con el .tmp, que es una
    // escritura completa que no llegó a renombrarse.
    try { fs.copyFileSync(DATA_FILE, `${DATA_FILE}.corrupt-${Date.now()}`); } catch {}
    try { state = JSON.parse(fs.readFileSync(DATA_FILE + '.tmp', 'utf8')); } catch {}
  }
  if (!Array.isArray(state.groups)) state.groups = [];
  state.tasks.forEach(t => {
    if (t.archived === undefined) t.archived = false;
    if (t.groupId === undefined) t.groupId = null;
    if (t.deleted === undefined) t.deleted = false;
    // Migración: las entradas de antes de esto no tenían "foto" del nombre de la
    // tarea en ese momento (el calendario leía el nombre actual, en vivo). Se les
    // pone el nombre que tiene ahora mismo como punto de partida; a partir de aquí
    // cada entrada nueva guarda el suyo propio y ya no cambia si renombras la tarea.
    t.entries.forEach(e => { if (e.nameAtTime === undefined) e.nameAtTime = t.name; });
    if (!Array.isArray(t.subtasks)) t.subtasks = [];
    // v2.7.1: tipo (en curso vs puntual) y memo persistente (p. ej. id ERP). Aditivo; Dynamics365 puede enriquecer memo/erpId.
    if (t.taskType !== 'ongoing' && t.taskType !== 'oneShot') t.taskType = 'ongoing';
    if (typeof t.memo !== 'string') t.memo = (t.memo == null ? '' : String(t.memo));
    t.memo = String(t.memo).trim().slice(0, 200);
  });
  try {
    if (fs.existsSync(SETTINGS_FILE)) settings = { ...settings, ...JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')) };
  } catch {}
  // 2.8: estreno del rediseño. Una sola vez, el tema pasa a Noche cálida con su acento; a
  // partir de ahí cada cual elige el que quiera en Ajustes y no se vuelve a tocar.
  const uiVista = Number(settings.uiVersion) || 0;
  if (uiVista < 3) { settings.theme = DEFAULT_THEME; settings.accent = null; }
  // 4 (2.8.3): el deslizador de translucidez ya mueve el panel lateral (y por encima de
  // mate es de cristal). Todos empiezan en mate, como lo venían viendo; el valor viejo
  // venía de cuando el deslizador apenas hacía nada.
  if (uiVista < 4) settings.bgOpacity = 100;
  // 2.8.3: de serie, el panel con un poco de cristal, esmerilado, y cristal líquido en los bocadillos.
  if (uiVista < 5) { settings.bgOpacity = 85; settings.blurEnabled = true; settings.liquidGlass = true; settings.colorMode = 'auto'; }
  if (uiVista < UI_VERSION) { settings.uiVersion = UI_VERSION; saveSettings(); }
  if (!THEMES[settings.theme]) settings.theme = DEFAULT_THEME;
}

// Escritura atómica: primero a un .tmp y luego se renombra encima. Si el PC se apaga a
// mitad, el fichero bueno sigue entero. Sin sangría: es un 30-40 % más pequeño y se
// escribe en cada acción.
function saveDataRaw() {
  const json = JSON.stringify(state);
  const tmp = DATA_FILE + '.tmp';
  try {
    fs.writeFileSync(tmp, json);
    fs.renameSync(tmp, DATA_FILE);
  } catch {
    // El antivirus o el indexador a veces bloquean el renombrado (EPERM/EBUSY): mejor
    // guardar directamente que no guardar.
    try { fs.writeFileSync(DATA_FILE, json); } catch {}
  }
}
function saveData() {
  saveDataRaw();
  if (sync) sync.schedulePush();   // sube los cambios al servidor (si hay sesión)
}

function saveSettings() {
  try { fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2)); } catch {}
}

// Registra (o quita) imputa.me del arranque de Windows según el ajuste.
// Al arrancar por el login se le pasa "--hidden" para ir directo a la bandeja
// sin abrir el panel. En desarrollo no se toca el registro (apuntaría a electron.exe).
function applyLoginItem() {
  if (!app.isPackaged) return;
  try {
    app.setLoginItemSettings({ openAtLogin: !!settings.openAtLogin, args: ['--hidden'] });
  } catch {}
}

// ── Utilidades de tiempo ─────────────────────────────────────────────────────
function totalSecondsForTask(task) {
  let total = 0;
  for (const entry of task.entries) {
    total += ((entry.end || Date.now()) - entry.start);
  }
  return Math.floor(total / 1000);
}

function todaySecondsForTask(task) {
  const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);
  let total = 0;
  for (const entry of task.entries) {
    const entryEnd = entry.end || Date.now();
    if (entryEnd < startOfDay.getTime()) continue;
    const from = Math.max(entry.start, startOfDay.getTime());
    total += Math.max(0, entryEnd - from);
  }
  return Math.floor(total / 1000);
}

// Segundos de UNA subtarea (o de la tarea "a secas", con subId null): mismo cálculo
// que el de la tarea, filtrando por la subtarea a la que se apuntó cada entrada.
function secondsForSub(task, subId, desde) {
  let total = 0;
  for (const entry of task.entries) {
    if ((entry.subId || null) !== (subId || null)) continue;
    const fin = entry.end || Date.now();
    if (desde != null && fin < desde) continue;
    total += Math.max(0, fin - (desde != null ? Math.max(entry.start, desde) : entry.start));
  }
  return Math.floor(total / 1000);
}

function totalTodaySeconds() {
  return state.tasks.reduce((sum, t) => sum + todaySecondsForTask(t), 0);
}

function formatDuration(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2,'0')}m`;
  return `${m}m ${String(s).padStart(2,'0')}s`;
}

function getActiveTask() {
  return state.tasks.find(t => t.id === state.activeTaskId) || null;
}

// ── Tray ─────────────────────────────────────────────────────────────────────
// Solo el tooltip, y solo si cambia. El menú ya no se reconstruye aquí: con una tarea
// en marcha esto se llamaba dos veces por segundo y cada vez se creaba y tiraba un
// menú nativo entero. Ahora se monta al hacer clic derecho (ver whenReady), con los
// tiempos al día.
// Una vez por minuto se reescribe aunque no cambie: si el Explorador se reinicia, Windows
// recrea el icono sin tooltip.
let lastTrayTip = null, lastTrayTipAt = 0;
function updateTrayTitle() {
  if (!tray) return;
  const active = getActiveTask();
  const tip = `imputa.me · ${formatDuration(totalTodaySeconds())}${active ? ' · ' + active.name : ''}`;
  const now = Date.now();
  if (tip !== lastTrayTip || now - lastTrayTipAt > 60000) {
    lastTrayTip = tip; lastTrayTipAt = now; tray.setToolTip(tip);
  }
}

function buildTrayMenu() {
  const active = getActiveTask();
  const taskItems = state.tasks.filter(t => !t.archived && !t.deleted && !isInactiveTask(t)).map(t => ({
    label: `${t.id === state.activeTaskId ? '▶ ' : '    '}${t.name}  (${formatDuration(todaySecondsForTask(t))})`,
    click: () => switchTask(t.id),
  }));
  return Menu.buildFromTemplate([
    { label: 'imputa.me', enabled: false },
    { label: `Hoy: ${formatDuration(totalTodaySeconds())}`, enabled: false },
    { type: 'separator' },
    ...taskItems,
    { type: 'separator' },
    { label: 'Panel', click: () => openMain() },
    { label: 'Calendario', click: () => openCalendar() },
    { label: 'Tareas', click: () => openGroups() },
    { label: 'Ajustes', click: () => openSettings() },
    { label: `Sincronizar (móvil)${syncStatus.loggedIn ? ' ✓' : ''}…`, click: () => openSync() },
    { label: 'Pausar', click: () => pauseActive(), enabled: !!active },
    { label: 'No molestar', type: 'checkbox', checked: dndActive(), click: () => setDnd(dndActive() ? null : 0) },
    { type: 'separator' },
    // Interruptor de escape: permite salir del modo dock desde la bandeja aunque su
    // interfaz no se viera bien, sin depender de abrir Ajustes dentro del propio dock.
    { label: 'Modo barra flotante (dock)', type: 'checkbox', checked: !!settings.dockMode, click: () => toggleDockMode() },
    // Si la barra se escondió desde su menú, esta es la forma de recuperarla.
    { label: 'Mostrar la barra ahora', click: () => hideDockFor(null), visible: !!settings.dockMode && dockIsHidden() },
    { label: 'Buscar actualizaciones…', click: () => checkForUpdates(true) },
    { label: 'Salir', click: () => { saveData(); app.quit(); } },
  ]);
}

function toggleDockMode() {
  const wasDock = !!settings.dockMode;
  settings.dockMode = !wasDock;
  saveSettings();
  applyDockMode(wasDock);
  updateTrayTitle();
}

// ── Acciones ─────────────────────────────────────────────────────────────────
function startTask(taskId, backMinutes, subId, note) {
  pauseActive();
  const task = state.tasks.find(t => t.id === taskId);
  if (!task) return;
  const sub = subId ? (task.subtasks || []).find(x => x.id === subId) : null;
  state.activeTaskId = taskId;
  state.activeSubId = sub ? sub.id : null;
  const start = backMinutes ? Date.now() - backMinutes * 60000 : Date.now();
  // nameAtTime: "foto" del nombre de la tarea al crear la entrada. El calendario es
  // un registro de lo que pasó, así que si luego renombras la tarea esta entrada no
  // cambia con ella (solo las que se creen después, con el nombre nuevo). La subtarea
  // guarda el suyo por lo mismo: borrarla no debe reescribir el historial.
  const entry = { start, end: null, nameAtTime: task.name };
  if (sub) { entry.subId = sub.id; entry.subNameAtTime = sub.name; }
  // Al continuar desde una entrada anterior se hereda su nota: sigues en lo mismo.
  const n = (note || '').trim().slice(0, 500);
  if (n) entry.note = n;
  task.entries.push(entry);
  saveData(); broadcastState(); resetReminderTimer();
}

function pauseActive() {
  const task = getActiveTask();
  if (task) {
    const last = task.entries[task.entries.length - 1];
    if (last && !last.end) {
      last.end = Date.now();
      // La nota se QUEDA con la entrada: es parte del registro de lo que hiciste en esa
      // sesión (se ve en el calendario). Al retomar la tarea se crea una entrada nueva
      // sin nota, así que el campo del panel vuelve a estar en blanco solo, sin tener
      // que borrar la de antes (que antes se perdía al pausar).
    }
  }
  state.activeTaskId = null;
  state.activeSubId = null;
  saveData(); broadcastState();
}

// Nota rápida sobre la tarea que está corriendo AHORA MISMO (desde el panel principal),
// para poder anotar sin querer que "formación" de hoy es en concreto un vídeo de sales.
// Se guarda en la propia entrada en curso, así que ya se ve reflejada en el calendario.
function setActiveEntryNote(note) {
  const task = getActiveTask();
  if (!task) return;
  const last = task.entries[task.entries.length - 1];
  if (!last || last.end) return;
  const n = (note || '').trim().slice(0, 500);
  if (n) last.note = n; else delete last.note;
  saveData(); broadcastState();
}

function switchTask(taskId, backMinutes, subId, note) {
  // Pulsar el play de lo que ya está corriendo lo pausa; si es otra tarea u otra
  // subtarea de la misma tarea, se cambia a ella.
  const mismaSub = (state.activeSubId || null) === (subId || null);
  if (state.activeTaskId === taskId && mismaSub) pauseActive();
  else startTask(taskId, backMinutes, subId, note);
}

// ── Subtareas ────────────────────────────────────────────────────────────────
// Viven dentro de la tarea ("Cocina" → horno, frigorífico...) y no son tareas aparte:
// cada entrada del calendario apunta a la suya, así que el tiempo de la tarea sigue
// siendo la suma de todo lo que se ha hecho dentro, sin cambiar nada de lo de antes.
function addSubtask(taskId, name) {
  const task = state.tasks.find(t => t.id === taskId);
  const n = (name || '').trim();
  if (!task || !n) return;
  if (!Array.isArray(task.subtasks)) task.subtasks = [];
  task.subtasks.push({ id: `${Date.now()}-${task.subtasks.length}`, name: n.slice(0, 120) });
  saveData(); broadcastState();
}

function renameSubtask(taskId, subId, name) {
  const task = state.tasks.find(t => t.id === taskId);
  const sub = task && (task.subtasks || []).find(x => x.id === subId);
  const n = (name || '').trim();
  if (!sub || !n) return;
  sub.name = n.slice(0, 120);   // las entradas ya hechas conservan su subNameAtTime
  saveData(); broadcastState();
}

// Quitarla de la lista NO borra su historial: las entradas guardan el nombre que tenía
// y se siguen viendo en el calendario, igual que al eliminar una tarea.
function deleteSubtask(taskId, subId) {
  const task = state.tasks.find(t => t.id === taskId);
  if (!task) return;
  task.subtasks = (task.subtasks || []).filter(x => x.id !== subId);
  if (state.activeTaskId === taskId && state.activeSubId === subId) pauseActive();
  saveData(); broadcastState();
}

// Cierra la sesión en curso de la tarea activa (como al pausar) y arranca ENSEGUIDA
// una nueva entrada para esa misma tarea, con una nota distinta. Sirve para partir
// el tiempo en dos cuando cambias de lo que estás haciendo dentro de la misma tarea,
// sin tener que pausar y volver a darle a play a mano.
function restartActiveTaskWithNote(note) {
  const task = getActiveTask();
  if (!task) return;
  const last = task.entries[task.entries.length - 1];
  if (last && !last.end) { last.end = Date.now(); }   // la nota de esa sesión se conserva en su entrada
  // Reiniciar con otra nota se queda en la misma subtarea: sigues en lo mismo.
  const entry = { start: Date.now(), end: null, nameAtTime: task.name };
  const sub = state.activeSubId ? (task.subtasks || []).find(x => x.id === state.activeSubId) : null;
  if (sub) { entry.subId = sub.id; entry.subNameAtTime = sub.name; }
  const n = (note || '').trim().slice(0, 500);
  if (n) entry.note = n;
  task.entries.push(entry);
  saveData(); broadcastState(); resetReminderTimer();
}

// Reabre una entrada ya cerrada (le quita la hora de fin) para que siga sumando hasta
// ahora, como si nunca se hubiera parado. Antes cierra lo que estuviera activo (si era
// otra tarea), para que solo haya una entrada "en curso" a la vez.
function resumeEntry(taskId, entryIndex) {
  const task = state.tasks.find(t => t.id === taskId);
  if (!task || !task.entries[entryIndex]) return;
  const entry = task.entries[entryIndex];
  if (entry.end == null) return;   // ya está en curso
  pauseActive();
  entry.end = null;
  // El resto de la app (el propio pauseActive, la nota rápida del panel principal...)
  // da por hecho que la entrada "en curso" es SIEMPRE la última del array. Si se
  // reanuda una que no lo era, hay que moverla al final para no romper eso: si no,
  // el panel mostraba/editaba la nota de otra entrada distinta (parecía que se borraba).
  task.entries.splice(entryIndex, 1);
  task.entries.push(entry);
  state.activeTaskId = taskId;
  // La entrada se reanuda entera: vuelve con su subtarea y con su nota. Sin esta línea
  // el panel se quedaba creyendo que no había subtarea en marcha.
  state.activeSubId = entry.subId || null;
  saveData(); broadcastState(); resetReminderTimer();
}

// Color de una tarea nueva: el elegido a mano si el modo es manual; si no, uno al azar de la
// paleta de su sección (si la tiene) o el siguiente de la rueda de siempre.
function colorForNewTask(groupId, manualColor) {
  if (settings.colorMode === 'manual' && manualColor) return manualColor;
  const g = groupId && state.groups.find(x => x.id === groupId);
  if (g && g.palette) {
    const enUso = state.tasks.filter(t => t.groupId === g.id && !t.deleted).map(t => t.color);
    const c = colorFromGroupPalette(g.palette, enUso);
    if (c) return c;
  }
  return nextAutoColor();
}

function createTask(name, color, opts) {
  const id = Date.now().toString();
  const o = opts || {};
  const finalColor = colorForNewTask(o.groupId, color);
  const taskType = o.taskType === 'oneShot' ? 'oneShot' : 'ongoing';
  const memo = (o.memo || '').trim().slice(0, 200);
  const task = { id, name, color: finalColor, entries: [], archived: false, groupId: null, taskType, memo };
  if (o.erpId) task.erpId = String(o.erpId).trim().slice(0, 120);
  state.tasks.push(task);
  saveData(); broadcastState();
  return id;
}

// Memo persistente + tipo: no tocan las entradas. El memo se muestra cada vez que
// usas la tarea (id Dynamics, recordatorio fijo...); la nota de sesión sigue en entry.note.
function updateTaskMeta(taskId, patch) {
  const task = state.tasks.find(t => t.id === taskId);
  if (!task || !patch) return;
  if (patch.taskType === 'ongoing' || patch.taskType === 'oneShot') task.taskType = patch.taskType;
  if (patch.memo !== undefined) {
    task.memo = (patch.memo || '').trim().slice(0, 200);
  }
  if (patch.erpId !== undefined) {
    const e = (patch.erpId || '').trim().slice(0, 120);
    if (e) task.erpId = e; else delete task.erpId;
  }
  if (patch.name !== undefined) {
    const n = (patch.name || '').trim();
    if (n) task.name = n.slice(0, 120);
  }
  saveData(); broadcastState();
}
// Nota fija (memo) de la tarea: sobrevive entre sesiones. Local-only — sync.js no
// la sube ni la baja; sirve p. ej. para el id de Dynamics/ERP. Max 200 chars.
function setTaskMemo(taskId, memo) {
  updateTaskMeta(taskId, { memo: memo == null ? '' : memo });
}


// Borrado "suave": la tarea desaparece del panel, de Guardadas y de los selectores,
// pero sus entradas SIGUEN en el calendario (con su nombre, nota y horas de siempre),
// porque el calendario es un registro de lo que de verdad ha pasado, no una vista en
// vivo de las tareas actuales.
function deleteTask(taskId) {
  const task = state.tasks.find(t => t.id === taskId);
  if (!task) return;
  if (state.activeTaskId === taskId) pauseActive();
  task.deleted = true;
  task.deletedAt = Date.now();   // para la papelera (se puede restaurar durante TRASH_RETENTION_DAYS)
  task.purged = false;
  saveData(); broadcastState();
}

// Devuelve la tarea a la vida: reaparece en el panel principal (sin sección). Vale
// tanto desde la papelera como desde el calendario (aunque ya haya caducado en la
// papelera), porque sus entradas nunca se han ido.
// Saca una tarea de Guardadas y la devuelve al panel principal. No toca su historial:
// las entradas del calendario se quedan exactamente como estaban.
function unarchiveTask(taskId) {
  const task = state.tasks.find(t => t.id === taskId);
  if (!task || !task.archived) return;
  task.archived = false;
  task.groupId = null;
  saveData(); broadcastState();
}

function restoreTask(taskId) {
  const task = state.tasks.find(t => t.id === taskId);
  if (!task) return;
  task.deleted = false;
  task.archived = false;
  task.groupId = null;
  delete task.deletedAt;
  delete task.purged;
  saveData(); broadcastState();
}

// "Eliminar definitivamente" desde la papelera: la saca de la lista de la papelera,
// pero sus entradas SIGUEN en el calendario (el calendario es un registro permanente),
// así que todavía se puede restaurar desde allí si hiciera falta.
function purgeTask(taskId) {
  const task = state.tasks.find(t => t.id === taskId);
  if (!task) return;
  task.purged = true;
  saveData(); broadcastState();
}

// Borrar desde el Archivador: mismo camino que "Eliminar tarea" (papelera, 30 días
// para arrepentirse, el calendario no se toca), pero de una tirada para "Vaciar todo"
// o para una selección concreta. Sin ids, se vacían TODAS las que sigan inactivas en
// este momento (por si algo cambió entre que se abrió el archivador y se pulsó vaciar).
function archivePurge(ids) {
  const objetivo = Array.isArray(ids) && ids.length
    ? state.tasks.filter(t => ids.includes(t.id) && isInactiveTask(t))
    : state.tasks.filter(t => isInactiveTask(t));
  if (!objetivo.length) return;
  objetivo.forEach(t => {
    if (state.activeTaskId === t.id) pauseActive();
    t.deleted = true;
    t.deletedAt = Date.now();
    t.purged = false;
  });
  saveData(); broadcastState();
}

function editTaskColor(taskId, color) {
  const task = state.tasks.find(t => t.id === taskId);
  if (!task || !color) return;
  task.color = color;
  saveData(); broadcastState();
}

// Solo cambia el nombre "en vivo" de la tarea: las entradas ya creadas guardan su
// propio nameAtTime y no se tocan (el calendario es un registro fijo). Afecta a las
// entradas que se creen A PARTIR DE AHORA. Para corregir una entrada ya existente,
// se edita su nombre desde el propio popup del calendario (solo cambia esa).
function renameTask(taskId, name) {
  const task = state.tasks.find(t => t.id === taskId);
  const n = (name || '').trim();
  if (!task || !n) return;
  task.name = n.slice(0, 120);
  saveData(); broadcastState();
}

// ── Grupos guardados ─────────────────────────────────────────────────────────
function archiveTask(taskId, groupId, groupName) {
  const task = state.tasks.find(t => t.id === taskId);
  if (!task) return;
  let gid = groupId;
  if (!gid && groupName) {
    const name = groupName.trim();
    if (!name) return;
    let group = state.groups.find(g => g.name.toLowerCase() === name.toLowerCase());
    if (!group) { group = { id: Date.now().toString(), name, order: nextGroupOrder() }; state.groups.push(group); }
    gid = group.id;
  }
  if (!gid || !state.groups.some(g => g.id === gid)) return;
  if (state.activeTaskId === taskId) pauseActive();
  task.archived = true;
  task.groupId = gid;
  saveData(); broadcastState();
}

function nextGroupOrder() {
  return state.groups.reduce((max, g) => Math.max(max, Number(g.order) || 0), 0) + 1;
}

// Las secciones se sirven ya ordenadas para que Guardadas solo tenga que pintarlas.
// 'created' usa el id, que es la marca de tiempo de cuando se creó.
function sortedGroups() {
  const gs = [...state.groups];
  const byCreation = (a, b) => String(a.id).localeCompare(String(b.id), undefined, { numeric: true });
  if (settings.groupSort === 'alpha') {
    gs.sort((a, b) => (a.name || '').localeCompare(b.name || '', 'es', { sensitivity: 'base' }));
  } else if (settings.groupSort === 'custom') {
    gs.sort((a, b) => {
      const ao = Number(a.order), bo = Number(b.order);
      if (Number.isFinite(ao) && Number.isFinite(bo) && ao !== bo) return ao - bo;
      return byCreation(a, b);   // las que nunca se han arrastrado, por antigüedad
    });
  } else {
    gs.sort(byCreation);
  }
  // El sentido se aplica al final, así vale para los tres criterios por igual.
  return settings.groupSortDir === 'desc' ? gs.reverse() : gs;
}

// Guarda el orden manual que deja el usuario al arrastrar secciones.
function reorderGroups(ids) {
  if (!Array.isArray(ids)) return;
  if (settings.groupSortDir === 'desc') ids = [...ids].reverse();
  ids.forEach((id, i) => {
    const g = state.groups.find(x => x.id === id);
    if (g) g.order = i + 1;
  });
  settings.groupSort = 'custom';   // arrastrar implica que manda el orden manual
  saveSettings(); saveData(); broadcastState();
}

function createGroup(name) {
  const n = (name || '').trim();
  if (!n) return null;
  let group = state.groups.find(g => g.name.toLowerCase() === n.toLowerCase());
  if (!group) { group = { id: Date.now().toString(), name: n.slice(0, 60), order: nextGroupOrder() }; state.groups.push(group); }
  saveData(); broadcastState();
  return group.id;
}

// Paleta de la sección (ver palettes.js). Sin paleta, sus tareas nuevas siguen la rueda de
// colores de siempre.
function setGroupPalette(groupId, palette) {
  const g = state.groups.find(x => x.id === groupId);
  if (!g) return;
  if (palette && GROUP_PALETTES[palette]) g.palette = palette;
  else delete g.palette;
  saveData(); broadcastState();
}

// Repinta las tareas que ya tiene la sección con tonos de su paleta, todos distintos
// mientras alcancen.
function recolorGroupTasks(groupId) {
  const g = state.groups.find(x => x.id === groupId);
  if (!g || !g.palette) return;
  const usados = [];
  state.tasks.filter(t => t.groupId === g.id && !t.deleted).forEach(t => {
    t.color = colorFromGroupPalette(g.palette, usados);
    usados.push(t.color);
  });
  saveData(); broadcastState();
}

function renameGroup(groupId, name) {
  const g = state.groups.find(x => x.id === groupId);
  const n = (name || '').trim();
  if (!g || !n) return;
  g.name = n.slice(0, 60);
  saveData(); broadcastState();
}

function deleteGroup(groupId) {
  if (!state.groups.some(g => g.id === groupId)) return;
  // Las tareas de la sección vuelven al panel principal (no se pierden).
  state.tasks.forEach(t => { if (t.groupId === groupId) { t.archived = false; t.groupId = null; } });
  state.groups = state.groups.filter(g => g.id !== groupId);
  saveData(); broadcastState();
}

// Mueve una tarea (ya guardada) de una sección a otra sin sacarla de "Guardadas".
// Cambia la sección de una tarea. Ya no la archiva: en la pestaña Tareas la sección es
// una etiqueta, y "archivada" solo decide si sigue apareciendo en el Panel.
function moveTaskToGroup(taskId, groupId) {
  const task = state.tasks.find(t => t.id === taskId);
  if (!task || !state.groups.some(g => g.id === groupId)) return;
  if (state.activeTaskId === taskId) pauseActive();
  task.groupId = groupId;
  task.archived = true;
  saveData(); broadcastState();
}

function restoreAndStartTask(taskId, backMinutes, subId, note) {
  const task = state.tasks.find(t => t.id === taskId);
  if (!task) return;
  task.archived = false;
  startTask(taskId, backMinutes, subId, note);   // se puede retomar directamente en una subtarea
  openMain();
}

function editEntry(taskId, entryIndex, startMs, endMs, note, name, subId) {
  const task = state.tasks.find(t => t.id === taskId);
  if (!task || !task.entries[entryIndex]) return;
  const e = task.entries[entryIndex];
  // Solo se aplica lo que llega. Al redimensionar se envía ÚNICAMENTE el borde que se
  // arrastra: si se mandaban los dos, el borde no tocado se pisaba con un valor viejo
  // (el calendario no se reconstruye con el ratón encima) y "se movía solo". Igual con
  // la nota: es propia de ESTA entrada, así que no toca el resto de veces que se ha
  // hecho la misma tarea. El nombre (nameAtTime) también es solo de esta entrada: no
  // renombra la tarea ni cambia otras entradas (para eso, doble clic en el panel).
  if (startMs !== undefined && startMs !== null) e.start = startMs;
  if (endMs !== undefined) e.end = endMs;
  if (note !== undefined) {
    const n = (note || '').trim().slice(0, 500);
    if (n) e.note = n; else delete e.note;
  }
  if (name !== undefined) {
    const nm = (name || '').trim().slice(0, 120);
    if (nm) e.nameAtTime = nm;
  }
  // La subtarea de ESTA entrada: para corregir a qué parte de la tarea fue este rato.
  // '' (o null) la deja sin subtarea, apuntada a la tarea a secas.
  if (subId !== undefined) {
    const sub = subId ? (task.subtasks || []).find(x => x.id === subId) : null;
    if (sub) { e.subId = sub.id; e.subNameAtTime = sub.name; }
    else { delete e.subId; delete e.subNameAtTime; }
    // Si se le quita la subtarea a la entrada en curso, el panel tiene que enterarse.
    if (state.activeTaskId === taskId && entryIndex === task.entries.length - 1 && !e.end) {
      state.activeSubId = sub ? sub.id : null;
    }
  }
  saveData(); broadcastState();
}

function deleteEntry(taskId, entryIndex) {
  const task = state.tasks.find(t => t.id === taskId);
  if (!task || !task.entries[entryIndex]) return;
  task.entries.splice(entryIndex, 1);
  if (state.activeTaskId === taskId && !task.entries.some(e => !e.end)) state.activeTaskId = null;
  saveData(); broadcastState();
}

function addCalendarEntry(taskId, newTaskName, newTaskColor, startMs, endMs, note, subId, newTaskGroupId) {
  let task = state.tasks.find(t => t.id === taskId);
  if (!task && newTaskName) {
    const id = Date.now().toString();
    const finalColor = colorForNewTask(newTaskGroupId, newTaskColor);
    task = { id, name: newTaskName, color: finalColor, entries: [], archived: false, groupId: null, taskType: 'ongoing', memo: '' };
    // La sección es solo su etiqueta (igual que al crear desde "Empezar una tarea
    // ahora"): se le pone y la tarea sigue sin archivar, así que nace ya dentro de su
    // sección en Tareas y a la vez a mano en el Panel.
    if (newTaskGroupId && state.groups.some(g => g.id === newTaskGroupId)) task.groupId = newTaskGroupId;
    state.tasks.push(task);
  }
  if (!task || startMs == null) return;
  const entry = { start: startMs, end: endMs || null, nameAtTime: task.name };
  const n = (note || '').trim().slice(0, 500);
  if (n) entry.note = n;
  if (subId) {
    const sub = (task.subtasks || []).find(x => x.id === subId);
    if (sub) { entry.subId = sub.id; entry.subNameAtTime = sub.name; }
  }
  task.entries.push(entry);
  saveData(); broadcastState();
}

// ── Reminder widget ───────────────────────────────────────────────────────────
function getReminderMs() {
  return (settings.reminderMinutes || 10) * 60000;
}

function resetReminderTimer() {
  if (reminderTimer) clearTimeout(reminderTimer);
  if (state.activeTaskId) reminderTimer = setTimeout(showReminder, getReminderMs());
}

function showReminder() {
  if (!state.activeTaskId) return;
  if (dndActive()) { reminderTimer = setTimeout(showReminder, getReminderMs()); return; }
  if (widgetWin && !widgetWin.isDestroyed()) { sendStateToWindow(widgetWin); widgetWin.showInactive(); scheduleWidgetAutoHide(); }
  else createWidgetWindow();
  reminderTimer = setTimeout(showReminder, getReminderMs());
}

// ── No molestar ──────────────────────────────────────────────────────────────
// Mientras está puesto no sale NINGÚN aviso por encima de lo que estés haciendo: ni
// el recordatorio de las horas, ni los ojos del 20-20-20, ni las notificaciones de
// hora de salida o de actualización. Lo que sí sigue funcionando es lo que no
// interrumpe: los cronómetros cuentan igual y, si lo pediste, la tarea se para sola
// a tu hora aunque no te lo diga.
function dndActive() {
  const d = Number(settings.dndUntil) || 0;
  if (d === -1) return true;
  if (d > Date.now()) return true;
  if (d !== 0) { settings.dndUntil = 0; saveSettings(); broadcastState(); }   // ya venció
  return false;
}

// minutos = 0 lo deja puesto hasta que se quite; null lo quita.
function setDnd(minutos) {
  if (minutos === null) settings.dndUntil = 0;
  else if (!minutos) settings.dndUntil = -1;
  else settings.dndUntil = Date.now() + minutos * 60000;
  saveSettings();
  if (dndActive()) {
    // Lo que ya estuviera asomando se retira en el acto.
    hideEyeCare();
    hideWidget();
  }
  broadcastState(); updateTrayTitle();
}

// ── Aviso de hora de salida ──────────────────────────────────────────────────

// Devuelve la hora de salida de hoy ('HH:MM') o null si hoy no toca avisar.
// Hora de salida de un dia concreto ('HH:MM'), o null si ese dia no toca avisar.
function leaveTimeForDate(d) {
  if (!settings.leaveEnabled) return null;
  if (settings.leaveSameEveryDay) return settings.leaveTime || null;
  const dias = settings.leaveDays || {};
  return dias[d.getDay()] || null;
}

// Primera hora de salida que ya ha pasado desde que empezo el rato en curso. Se recorre
// dia a dia desde que arranco, no solo hoy: si el ordenador se suspende (o se apaga) a
// las tres de la tarde y no se vuelve a tocar hasta mañana, la hora de salida de AYER
// tambien cuenta. Antes solo se miraba la de hoy y ademas se descartaba pasada una hora,
// asi que en el caso para el que existe esto -te vas y dejas el equipo- no hacia nada.
function primeraSalidaPasada(desdeMs) {
  const ahora = Date.now();
  const dia = new Date(desdeMs); dia.setHours(0, 0, 0, 0);
  for (let i = 0; i < 40; i++) {          // tope de seguridad, no un limite real
    if (dia.getTime() > ahora) break;
    const hhmm = leaveTimeForDate(dia);
    if (hhmm) {
      const [h, m] = String(hhmm).split(':').map(Number);
      if (Number.isFinite(h) && Number.isFinite(m)) {
        const corte = new Date(dia); corte.setHours(h, m, 0, 0);
        const t = corte.getTime();
        if (t > desdeMs && t <= ahora) return t;
      }
    }
    dia.setDate(dia.getDate() + 1);
  }
  return null;
}

function checkLeaveTime() {
  if (!settings.leaveEnabled || !state.activeTaskId) return;   // sin nada corriendo, nada que parar
  const task = getActiveTask();
  const last = task && task.entries[task.entries.length - 1];
  if (!last || last.end) return;

  const corte = primeraSalidaPasada(last.start);
  if (corte == null) return;
  if (leaveNotifiedOn === corte) return;   // ya atendido (la marca es el corte, no el dia)

  // Con No molestar puesto no se avisa, pero si se para: parar no interrumpe nada, y es
  // justo lo que se ha pedido que pase. Sin parada automatica, se deja sin marcar para
  // que el aviso llegue en cuanto se quite el silencio.
  if (dndActive() && !settings.leaveAutoStop) return;
  leaveNotifiedOn = corte;

  if (settings.leaveAutoStop) {
    // El rato se cierra A LA HORA DE SALIDA, no en el momento en que la app se entera:
    // si el equipo estuvo suspendido, apuntar la hora de encenderlo seria contar horas
    // que nadie ha trabajado.
    last.end = Math.max(last.start, corte);
    state.activeTaskId = null;
    state.activeSubId = null;
    saveData(); broadcastState(); updateTrayTitle(); resetReminderTimer();
    if (!dndActive()) notifyLeaveTime(task, true, corte);
    return;
  }

  // Solo aviso: aqui si tiene sentido rendirse si ya es tarde. Un recordatorio de que
  // pares la tarea saltando a las tres de la madrugada no le sirve a nadie.
  if (Date.now() - corte > 60 * 60000) return;
  if (!dndActive()) notifyLeaveTime(task, false, corte);
}

function notifyLeaveTime(task, parada, corte) {
  const nombre = task ? task.name : 'una tarea';
  const llevas = task ? fmtDuration(todaySecondsForTask(task)) : '';
  const hora = corte ? `${String(new Date(corte).getHours()).padStart(2, '0')}:${String(new Date(corte).getMinutes()).padStart(2, '0')}` : '';
  try {
    if (!Notification.isSupported()) return;
    const n = new Notification({
      title: 'imputa.me · hora de salida',
      body: parada
        ? `He parado "${nombre}"${hora ? ` a las ${hora}` : ''}. Hasta mañana.`
        : `Sigues con "${nombre}"${llevas ? ` (${llevas} hoy)` : ''}. ¿La paras antes de irte?`,
      icon: APP_ICON_PATH,
      silent: false,
    });
    n.on('click', () => openMain());   // el panel, con el play/pausa a mano
    n.show();
  } catch {}
}

function fmtDuration(secs) {
  const h = Math.floor(secs / 3600), m = Math.floor((secs % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function startLeaveWatcher() {
  if (leaveTimer) clearInterval(leaveTimer);
  leaveTimer = setInterval(checkLeaveTime, 30000);
  checkLeaveTime();
}

// ── Menú del clic derecho sobre la barra ─────────────────────────────────────
// Menú nativo a propósito: se pinta por encima de todo, se coloca solo y se cierra
// como el usuario espera, sin tener que resolver nada de eso dentro de la ventana
// transparente y click-through de la barra.
function showDockContextMenu() {
  if (!dockWin || dockWin.isDestroyed()) return;
  const activa = getActiveTask();
  const displays = screen.getAllDisplays();
  const actual = dockDisplay();

  const esconder = (min, etiqueta) => ({ label: etiqueta, click: () => hideDockFor(min) });

  const plantilla = [
    { label: 'imputa.me', enabled: false },
    { label: `Hoy: ${formatDuration(totalTodaySeconds())}`, enabled: false },
    { type: 'separator' },
    activa
      ? { label: `Pausar «${activa.name}»`, click: () => pauseActive() }
      : { label: 'No hay ninguna tarea en marcha', enabled: false },
    { type: 'separator' },
    dndActive()
      ? { label: 'Quitar el modo no molestar', click: () => setDnd(null) }
      : {
          label: 'No molestar',
          submenu: [15, 30, 60, 120, 480].map(m => ({
            label: m < 60 ? `${m} minutos` : `${m / 60} hora${m > 60 ? 's' : ''}`,
            click: () => setDnd(m),
          })).concat([{ type: 'separator' }, { label: 'Hasta que lo quite', click: () => setDnd(0) }]),
        },
    {
      label: 'Esconder la barra',
      submenu: [
        esconder(15, '15 minutos'),
        esconder(30, '30 minutos'),
        esconder(60, '1 hora'),
        esconder(120, '2 horas'),
        esconder(480, '8 horas'),
        { type: 'separator' },
        esconder(0, 'Hasta que la muestre yo'),
      ],
    },
    {
      label: 'Cambiar de pantalla',
      enabled: displays.length > 1,
      submenu: displays.map((d, i) => ({
        label: `Pantalla ${i + 1}${d.bounds.x === 0 && d.bounds.y === 0 ? ' (principal)' : ''} · ${d.size.width}×${d.size.height}`,
        type: 'radio',
        checked: d.id === actual.id,
        click: () => {
          settings.dockDisplayId = d.id;
          settings.dockDisplayKey = displayKey(d);
          saveSettings(); positionDock(); syncDockBounds(); ensureDockBarVisible();
        },
      })),
    },
    {
      label: 'Cambiar de borde',
      submenu: [['left', 'Izquierda'], ['right', 'Derecha'], ['top', 'Arriba'], ['bottom', 'Abajo']].map(([v, etiqueta]) => ({
        label: etiqueta,
        type: 'radio',
        checked: (settings.dockAnchor || 'right') === v,
        click: () => { settings.dockAnchor = v; saveSettings(); positionDock(); syncDockBounds(); },
      })),
    },
    { type: 'separator' },
    { label: 'Calendario', click: () => openCalendar() },
    { label: 'Tareas', click: () => openGroups() },
    { label: 'Ajustes', click: () => openSettings() },
  ];

  if (imputeUrls().length) {
    plantilla.push({ label: 'Imputar…', click: () => openImputeUrl() });
  }

  plantilla.push(
    { type: 'separator' },
    // Modo clásico = ventanas sueltas de siempre, sin barra flotante.
    { label: 'Cambiar a modo clásico (ventanas)', click: () => toggleDockMode() },
    { label: 'Salir de imputa.me', click: () => { saveData(); app.quit(); } },
  );

  try { Menu.buildFromTemplate(plantilla).popup({ window: dockWin }); } catch {}
}

// ── Días visibles del calendario ─────────────────────────────────────────────
const DIAS_SEMANA = [[1, 'Lunes'], [2, 'Martes'], [3, 'Miércoles'], [4, 'Jueves'],
                     [5, 'Viernes'], [6, 'Sábado'], [0, 'Domingo']];

function defaultWeekDays() {
  const d = Array.isArray(settings.weekDays) ? settings.weekDays : [];
  return d.length ? d : [1, 2, 3, 4, 5, 6, 0];
}

function weekDaysFor(clave) {
  const ov = settings.weekOverrides && settings.weekOverrides[clave];
  return Array.isArray(ov) ? ov : defaultWeekDays();
}

// Las excepciones son de usar y tirar: pasado un año no le importan a nadie y solo
// engordarían el fichero de ajustes.
function pruneWeekOverrides() {
  const ovs = settings.weekOverrides;
  if (!ovs) return;
  const limite = Date.now() - 365 * 86400000;
  Object.keys(ovs).forEach(k => {
    const t = Date.parse(k + 'T00:00:00');
    if (Number.isFinite(t) && t < limite) delete ovs[k];
  });
}

// Menú para elegir qué días se ven. Los cambios de aquí son SOLO de esa semana; el
// ajuste permanente está en Ajustes, y desde aquí se puede volver a él.
function showWeekDaysMenu(clave) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(clave || ''))) return;
  const win = BrowserWindow.getFocusedWindow() || dockPanelWin || calendarWin;
  const visibles = weekDaysFor(clave);
  const hayExcepcion = !!(settings.weekOverrides && settings.weekOverrides[clave]);

  const plantilla = [
    { label: 'Días de esta semana', enabled: false },
    { type: 'separator' },
    ...DIAS_SEMANA.map(([n, etiqueta]) => ({
      label: etiqueta,
      type: 'checkbox',
      checked: visibles.includes(n),
      click: () => {
        const nuevos = visibles.includes(n) ? visibles.filter(x => x !== n) : [...visibles, n];
        if (!nuevos.length) return;   // dejar la semana sin días no tiene sentido
        if (!settings.weekOverrides) settings.weekOverrides = {};
        settings.weekOverrides[clave] = nuevos;
        pruneWeekOverrides();
  // Antes solo se podía guardar un enlace. El que hubiera pasa a ser el primero de la
  // lista, sin que el usuario tenga que volver a escribirlo.
  if (!Array.isArray(settings.imputeUrls)) settings.imputeUrls = [];
  if (!settings.imputeUrls.length && settings.imputeUrl) settings.imputeUrls = [settings.imputeUrl];
  settings.imputeUrls = settings.imputeUrls.map(normalizeUrl).filter(Boolean); saveSettings(); broadcastState();
      },
    })),
    { type: 'separator' },
    {
      label: 'Volver a mis días de siempre',
      enabled: hayExcepcion,
      click: () => {
        delete settings.weekOverrides[clave];
        saveSettings(); broadcastState();
      },
    },
    { label: 'Cambiar mis días de siempre…', click: () => openSettings() },
  ];
  try { Menu.buildFromTemplate(plantilla).popup(win ? { window: win } : {}); } catch {}
}

// ── Menú del clic derecho sobre una entrada del calendario ───────────────────
// Sirve sobre todo para archivar la tarea en una sección sin tener que ir al panel,
// que es donde estaba ese botón hasta ahora.
function showCalendarContextMenu(taskId, entryIndex) {
  const task = state.tasks.find(t => t.id === taskId);
  if (!task) return;
  const win = BrowserWindow.getFocusedWindow() || dockPanelWin || calendarWin;
  const enMarcha = state.activeTaskId === task.id;

  const avisar = (canal, datos) => {
    [calendarWin, dockPanelWin].forEach(w => {
      if (w && !w.isDestroyed()) sendToAllFrames(w, canal, datos);
    });
  };

  const secciones = sortedGroups().map(g => ({
    label: g.name,
    type: 'radio',
    checked: task.archived && task.groupId === g.id,
    click: () => archiveTask(task.id, g.id),
  }));

  const plantilla = [
    { label: task.name, enabled: false },
    { type: 'separator' },
  ];

  if (task.deleted) {
    plantilla.push({ label: 'Restaurar la tarea', click: () => restoreTask(task.id) });
  } else {
    plantilla.push({
      label: task.archived ? 'Mover a otra sección' : 'Guardar en una sección',
      submenu: secciones.concat(
        secciones.length ? [{ type: 'separator' }] : [],
        [{ label: 'Sección nueva…', click: () => avisar('ask-new-group', task.id) }],
      ),
    });
    if (task.archived) {
      plantilla.push({ label: 'Sacar de Guardadas', click: () => unarchiveTask(task.id) });
    }
    // Mismos controles que el popup de la entrada, para no tener que abrirlo.
    const entrada = task.entries[entryIndex];
    const enCurso = entrada && entrada.end == null;
    plantilla.push({ type: 'separator' });
    if (enMarcha && enCurso) {
      plantilla.push({ label: 'Pausar', click: () => pauseActive() });
    } else if (enMarcha) {
      // Rato viejo de una tarea que ya corre en otro. Sin esto el menú se quedaba sin
      // acciones y parecía que iban y venían. No se ofrece alargar: reabrir este rato
      // hasta ahora se solaparía con el que está en marcha.
      plantilla.push({ label: 'Pausar la tarea', click: () => pauseActive() });
    } else if (entrada) {
      // Las dos maneras de retomar: una entrada nueva desde ahora, o estirar esta
      // hasta ahora. En ambas se conservan la subtarea y la nota de este rato.
      const sub = entrada.subId && (task.subtasks || []).some(x => x.id === entrada.subId)
        ? entrada.subId : undefined;
      plantilla.push(
        { label: 'Nueva entrada desde ahora', click: () => startTask(task.id, 0, sub, entrada.note) },
        { label: 'Alargar esta hasta ahora', click: () => resumeEntry(task.id, entryIndex) },
      );
    }
  }

  plantilla.push(
    { type: 'separator' },
    { label: 'Editar esta entrada…', click: () => avisar('open-entry-popup', { taskId: task.id, entryIndex }) },
    { label: 'Eliminar esta entrada', click: () => deleteEntry(task.id, entryIndex) },
  );

  try { Menu.buildFromTemplate(plantilla).popup(win ? { window: win } : {}); } catch {}
}

// ── Enlace para imputar ──────────────────────────────────────────────────────
// Se acepta lo que el usuario pegue: si no trae esquema, se le pone https://. Solo
// http y https, para que un enlace guardado no pueda acabar abriendo otra cosa.
function normalizeUrl(url) {
  if (!url) return '';
  const conEsquema = /^[a-zA-Z][\w+.-]*:\/\//.test(url) ? url : `https://${url}`;
  try {
    const u = new URL(conEsquema);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
    return u.toString();
  } catch { return ''; }
}

function imputeUrls() {
  return (settings.imputeUrls || []).map(normalizeUrl).filter(Boolean);
}

// Sin argumentos abre el único que haya; con uno concreto, ese; con todos:true, los
// abre en orden y separados unas décimas para que el navegador no se atragante y se
// coma alguna pestaña.
function openImputeUrl(cual) {
  const lista = imputeUrls();
  if (!lista.length) return;
  const shell = require('electron').shell;
  if (cual && cual.all) {
    lista.forEach((u, i) => setTimeout(() => { try { shell.openExternal(u); } catch {} }, i * 250));
    return;
  }
  const url = cual && cual.url ? normalizeUrl(cual.url) : lista[0];
  if (url && lista.includes(url)) { try { shell.openExternal(url); } catch {} }
}

// ── Regla 20-20-20 ───────────────────────────────────────────────────────────
const EYE_RATIO = 0.78;   // alto respecto al ancho de la burbuja

// La ventana mide exactamente lo que la burbuja: sin sombra no hay nada que se salga
// del redondeo, así que no hace falta reservarle hueco (y el tamaño de Ajustes vuelve
// a ser el de lo que se ve).
function eyeCareBounds() {
  const work = dockDisplay().workArea;
  const w = Math.max(80, Math.min(420, Number(settings.eyeCareSize) || 150));
  const h = Math.round(w * EYE_RATIO);
  const m = 18;   // separación del borde
  const pos = settings.eyeCarePos || 'top';
  const izq = work.x + m;
  const centro = work.x + Math.round((work.width - w) / 2);
  const der = work.x + work.width - w - m;
  const arriba = work.y + m;
  const abajo = work.y + work.height - h - m;
  const x = pos.includes('Left') ? izq : pos.includes('Right') ? der : centro;
  const y = pos.startsWith('bottom') ? abajo : arriba;
  return { x, y, width: w, height: h };
}

function createEyeCareWindow() {
  if (eyeCareWin && !eyeCareWin.isDestroyed()) return eyeCareWin;
  const b = eyeCareBounds();
  eyeCareWin = new BrowserWindow({
    ...b,
    // backgroundColor transparente EXPLÍCITO: sin él, una ventana transparent:true en
    // Windows se pinta con fondo opaco (negro) y ese fondo asoma por fuera del redondeo
    // de la burbuja. Es lo que dejaba las esquinas cuadradas negras. Las otras ventanas
    // transparentes (la barra y el botón de ocultar) ya lo llevaban; a esta se me pasó.
    // roundedCorners:false porque el redondeo lo pone el CSS de la burbuja; dejando
    // que Windows redondee además la ventana solo se añaden recortes raros encima.
    frame: false, transparent: true, hasShadow: false, backgroundColor: '#00000000',
    resizable: false, roundedCorners: false,
    // focusable:false para no sacar al usuario de lo que esté haciendo; el clic para
    // quitarla de en medio sigue llegando igual.
    skipTaskbar: true, alwaysOnTop: true, focusable: false, show: false,
    webPreferences: { nodeIntegration: true, contextIsolation: false },
  });
  // 'screen-saver' la pone por encima incluso de aplicaciones a pantalla completa,
  // que es justo cuando más falta hace acordarse de mirar a lo lejos.
  try { eyeCareWin.setAlwaysOnTop(true, 'screen-saver'); } catch {}
  eyeCareWin.loadFile(path.join(__dirname, 'src', 'eyecare.html'));
  eyeCareWin.on('closed', () => { eyeCareWin = null; });
  return eyeCareWin;
}

function showEyeCare(segundos, forzar) {
  // forzar = la vista previa de Ajustes, que la pide el usuario a propósito.
  if (dndActive() && !forzar) return;
  const win = createEyeCareWindow();
  if (!win || win.isDestroyed()) return;
  const secs = Math.max(1, Number(segundos) || Number(settings.eyeCareRest) || 20);
  try { win.setBounds(eyeCareBounds()); } catch {}
  const lanzar = () => {
    if (!win || win.isDestroyed()) return;
    try { win.showInactive(); win.webContents.send('eye-start', secs, { soloOjos: !!settings.eyeCareSoloOjos }); } catch {}
  };
  if (win.webContents.isLoading()) win.webContents.once('did-finish-load', lanzar);
  else lanzar();

  // Red de seguridad: si el renderer se atasca, la burbuja no se queda ahí clavada.
  if (eyeCareHideTimer) clearTimeout(eyeCareHideTimer);
  eyeCareHideTimer = setTimeout(hideEyeCare, (secs + 4) * 1000);
}

function hideEyeCare() {
  if (eyeCareHideTimer) { clearTimeout(eyeCareHideTimer); eyeCareHideTimer = null; }
  try { if (eyeCareWin && !eyeCareWin.isDestroyed()) eyeCareWin.hide(); } catch {}
}

function eyeCareEveryMin() {
  return Math.max(1, Math.min(180, Number(settings.eyeCareEvery) || 20));
}

// Se lleva la HORA del próximo aviso en vez de un setInterval largo. Dos motivos:
//   - startEyeCareTimer() se llamaba en cada cambio de Ajustes, y Ajustes lo manda en
//     cada movimiento de deslizador, así que toquetear el tamaño o la posición
//     reiniciaba la cuenta y el aviso se iba retrasando indefinidamente.
//   - un setInterval de 20 minutos no corre mientras el ordenador está suspendido, así
//     que al despertar la cuenta iba desfasada.
// Con una hora objetivo y un latido corto, ninguna de las dos cosas afecta.
function reprogramEyeCare(desdeCero) {
  if (!settings.eyeCareEnabled) { eyeCareNextAt = 0; return; }
  if (desdeCero || !eyeCareNextAt) eyeCareNextAt = Date.now() + eyeCareEveryMin() * 60000;
}

function startEyeCareTimer(desdeCero) {
  if (eyeCareTimer) { clearInterval(eyeCareTimer); eyeCareTimer = null; }
  if (!settings.eyeCareEnabled) { hideEyeCare(); eyeCareNextAt = 0; return; }
  reprogramEyeCare(desdeCero);
  eyeCareTimer = setInterval(tickEyeCare, 15000);
}

function tickEyeCare() {
  if (!settings.eyeCareEnabled || !eyeCareNextAt) return;
  if (Date.now() < eyeCareNextAt) return;
  eyeCareNextAt = Date.now() + eyeCareEveryMin() * 60000;
  showEyeCare();
}

let widgetHideTimer = null;
function scheduleWidgetAutoHide() {
  if (widgetHideTimer) clearTimeout(widgetHideTimer);
  widgetHideTimer = null;
  if (!settings.widgetAutoHide) return;
  const ms = (settings.widgetAutoHideSeconds || 10) * 1000;
  widgetHideTimer = setTimeout(() => { widgetHideTimer = null; hideWidget(); }, ms);
}

function applyTranslucency(win) {
  if (!win || win.isDestroyed()) return;
  try { win.setOpacity(1); } catch {}
  try { win.setBackgroundColor('#00000000'); } catch {}   // deja ver el material de debajo
  // 'acrylic' = difuminado del sistema; 'none' = sin difuminar (solo el tinte).
  try { win.setBackgroundMaterial(settings.blurEnabled === false ? 'none' : 'acrylic'); } catch {}
}

// El acrílico lo pinta Windows y toma su tinte del modo claro/oscuro DEL SISTEMA: con
// Windows en claro salía blanquecino aunque el tema de la app fuese oscuro. Forzando el
// themeSource a juego con el tema elegido, el difuminado sale del color correcto.
function applySystemThemeSource() {
  const t = THEMES[settings.theme] || THEMES[DEFAULT_THEME];
  try { nativeTheme.themeSource = t.scheme === 'light' ? 'light' : 'dark'; } catch {}
}

function applyTranslucencyAll() {
  applySystemThemeSource();
  // Ni la barrita ni (desde la 2.8) el panel del dock ni (2.8.3) el recordatorio llevan
  // material: son transparentes a propósito, y applyTranslucency les haría setOpacity.
  [mainWin, calendarWin, groupsWin, settingsWin, syncWin, updateWin]
    .forEach(w => applyTranslucency(w));
  broadcastTheme();
}

// Paleta actual, ya resuelta (ver themes.js).
function themeVars() {
  return resolverTema(settings);
}

function broadcastTheme() {
  const vars = themeVars();
  [mainWin, calendarWin, groupsWin, settingsWin, widgetWin, syncWin, updateWin, dockWin, splashWin]
    .forEach(w => sendToAllFrames(w, 'theme', vars));
  sendToAllFrames(dockPanelWin, 'theme', vars);
}

// Guardado diferido de ajustes: los deslizadores de la barra flotante disparan cambios
// decenas de veces por segundo y no hace falta escribir el archivo en cada uno.
const saveSettingsSoon = (() => {
  let t = null;
  return () => { clearTimeout(t); t = setTimeout(saveSettings, 400); };
})();

function debounce(fn, ms) {
  let t = null;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

// La pantalla "de referencia" para abrir/posicionar ventanas nuevas: la que tenga el
// panel principal en ese momento (si no existe todavía, la principal del sistema).
function getReferenceDisplay() {
  // En modo dock las ventanas sueltas están escondidas y sus límites pueden apuntar a
  // un monitor que ya no existe: ahí la referencia buena es la principal.
  if (!settings.dockMode && mainWin && !mainWin.isDestroyed() && mainWin.isVisible()) {
    try { return screen.getDisplayMatching(mainWin.getBounds()); } catch {}
  }
  return screen.getPrimaryDisplay();
}

// Recalcula los límites min/max de una ventana según la pantalla en la que esté AHORA
// (guardados como "medidas de diseño" en win.__sizeSpec, sin recortar), y si con el
// nuevo límite ya no cabe, la encoge para que quede dentro del área de trabajo.
function adaptWindowToItsDisplay(win) {
  if (!win || win.isDestroyed() || !win.__sizeSpec) return;
  const { minWidth, minHeight, maxWidth, maxHeight } = win.__sizeSpec;
  let disp;
  try { disp = screen.getDisplayMatching(win.getBounds()); } catch { return; }
  const work = disp.workArea;
  const cappedMaxW = Math.max(minWidth, Math.min(maxWidth, work.width));
  const cappedMaxH = Math.max(minHeight, Math.min(maxHeight, work.height));
  try { win.setMaximumSize(cappedMaxW, cappedMaxH); } catch {}
  try { win.setMinimumSize(Math.min(minWidth, cappedMaxW), Math.min(minHeight, cappedMaxH)); } catch {}
  const b = win.getBounds();
  const newW = Math.min(b.width, cappedMaxW);
  const newH = Math.min(b.height, cappedMaxH);
  if (newW !== b.width || newH !== b.height) {
    const x = Math.min(Math.max(b.x, work.x), work.x + work.width - newW);
    const y = Math.min(Math.max(b.y, work.y), work.y + work.height - newH);
    try { win.setBounds({ x, y, width: newW, height: newH }); } catch {}
  }
}

// w/h son el tamaño "ideal" de arranque; minWidth/minHeight/maxWidth/maxHeight en opts
// son las medidas DE DISEÑO (sin recortar a ninguna pantalla en concreto): makeWindow las
// ajusta ya a la pantalla de referencia al crearla, y las reajusta sola si la ventana se
// mueve a otra pantalla (ver adaptWindowToItsDisplay, enganchado al evento 'move').
function makeWindow(file, w, h, opts = {}) {
  const { minWidth, minHeight, maxWidth, maxHeight, x, y, center, ...restOpts } = opts;
  const disp = getReferenceDisplay();
  const work = disp.workArea;

  const designMinW = minWidth || 0;
  const designMinH = minHeight || 0;
  const designMaxW = maxWidth || 100000;
  const designMaxH = maxHeight || 100000;
  const cappedMaxW = Math.max(designMinW, Math.min(designMaxW, work.width));
  const cappedMaxH = Math.max(designMinH, Math.min(designMaxH, work.height));
  const initW = Math.max(Math.min(designMinW, cappedMaxW), Math.min(w, cappedMaxW));
  const initH = Math.max(Math.min(designMinH, cappedMaxH), Math.min(h, cappedMaxH));

  let posX = x, posY = y;
  if (posX == null && posY == null && center !== false) {
    posX = work.x + Math.round((work.width - initW) / 2);
    posY = work.y + Math.round((work.height - initH) / 2);
  }

  const win = new BrowserWindow({
    width: initW, height: initH,
    x: posX, y: posY,
    minWidth: Math.min(designMinW, cappedMaxW), minHeight: Math.min(designMinH, cappedMaxH),
    maxWidth: cappedMaxW, maxHeight: cappedMaxH,
    // OJO: en Windows, backgroundMaterial (el acrílico que da el desenfoque) se ignora
    // si la ventana es transparent:true. Estaba así, de modo que el "blur" nunca existió
    // y solo se veía el tinte con alfa. Con transparent:false + backgroundColor
    // transparente + backgroundMaterial, el sistema sí difumina lo que hay detrás, y las
    // esquinas las redondea el propio Windows (roundedCorners).
    frame: false, transparent: false, hasShadow: false,
    backgroundColor: '#00000000',
    backgroundMaterial: settings.blurEnabled === false ? 'none' : 'acrylic',
    resizable: true, roundedCorners: true,
    icon: WINDOW_ICON_PATH,
    ...restOpts,
    // Con el frenado de Chromium por defecto: una ventana visible sin foco sigue animando
    // igual; solo deja de pintar la que está oculta, minimizada o tapada del todo. Con
    // backgroundThrottling:false las ventanas escondidas (panel plegado, recordatorio)
    // seguían dibujando frames todo el día y el proceso de GPU no paraba.
    webPreferences: { nodeIntegration: true, contextIsolation: false },
  });
  win.__sizeSpec = { minWidth: designMinW, minHeight: designMinH, maxWidth: designMaxW, maxHeight: designMaxH };
  win.on('focus', () => checkForUpdatesIfStale());   // volver a la app = buen momento para mirar
  win.on('move', debounce(() => adaptWindowToItsDisplay(win), 200));
  win.loadFile(path.join(__dirname, 'src', file));
  applyTranslucency(win);
  return win;
}

// 2.8.3: el recordatorio es una tarjeta de cristal líquido dentro de una ventana
// transparente, con aire alrededor para su sombra y para la gota con la que entra y sale
// por el borde de la pantalla (ver widget.html). La tarjeta va abajo a la derecha de la
// ventana, a 20 px del borde; lo transparente deja pasar los clics (widget-raton).
function widgetEscala() { return Math.max(80, Math.min(150, Number(settings.widgetScale) || 100)) / 100; }
// La ventana tiene siempre el tamaño del recordatorio más grande (150 %): así el tamaño se
// cambia en vivo solo con CSS, sin redimensionar una ventana transparente (parpadea).
function widgetVentana() { return { w: Math.round(330 * 1.5) + 44 + 20, h: Math.round(200 * 1.5) + 44 + 20 }; }
function createWidgetWindow() {
  const work = getReferenceDisplay().workArea;
  // Si el usuario lo movió, vuelve donde lo dejó, siempre que siga dentro de alguna pantalla.
  const wb = widgetBounds;
  const ok = !!wb && screen.getAllDisplays().some(d => {
    const a = d.workArea;
    return wb.x >= a.x && wb.y >= a.y && wb.x < a.x + a.width && wb.y < a.y + a.height;
  });
  const { w: W, h: H } = widgetVentana();
  const w = widgetWin = new BrowserWindow({
    width: W, height: H,
    x: ok ? wb.x : work.x + work.width - W, y: ok ? wb.y : work.y + work.height - H,
    frame: false, transparent: true, hasShadow: false, backgroundColor: '#00000000',
    resizable: false, roundedCorners: false, alwaysOnTop: true, skipTaskbar: true,
    show: false,          // no mostrar al crear: mostramos sin activar (ver showInactive)
    icon: WINDOW_ICON_PATH,
    webPreferences: { nodeIntegration: true, contextIsolation: false },
  });
  w.loadFile(path.join(__dirname, 'src', 'widget.html'), { search: 'k=' + widgetEscala() });
  try { w.setIgnoreMouseEvents(true, { forward: true }); } catch {}
  // showInactive: aparece encima pero SIN robar el foco, para no sacarte de lo que
  // estuvieras escribiendo en otra aplicación.
  w.once('ready-to-show', () => {
    if (w.isDestroyed()) return;   // se retiró (No molestar, cerrar) antes de cargar
    w.showInactive(); sendStateToWindow(w); scheduleWidgetAutoHide();
  });
  // Se compara la instancia: si ya se creó otro recordatorio, no hay que perderlo.
  w.on('closed', () => { if (widgetWin === w) widgetWin = null; });
}

// El recordatorio se ve unos segundos cada X minutos: se destruye al retirarlo en vez
// de esconderlo. Escondido seguía vivo todo el día (un proceso de ~115 MB recibiendo
// el estado cada segundo); recrearlo cuesta menos de un segundo de CPU por aviso.
// Su posición se guarda en memoria para recrearlo en el mismo sitio. Antes de
// destruirlo se le deja irse con su animación (unos 560 ms).
let widgetBounds = null;
function hideWidget() {
  if (widgetHideTimer) { clearTimeout(widgetHideTimer); widgetHideTimer = null; }
  const w = widgetWin;
  widgetWin = null;
  if (!w || w.isDestroyed()) return;
  try {
    if (w.isVisible()) widgetBounds = w.getBounds();
    w.webContents.send('widget-salir');
  } catch {}
  setTimeout(() => { try { if (!w.isDestroyed()) w.destroy(); } catch {} }, 680);
}

// ── Modo dock (barra flotante lateral) ────────────────────────────────────────
// La ventana tiene tamaño FIJO (el del panel desplegado) y NO se redimensiona: el
// plegar/desplegar es puramente CSS dentro del renderer (fluido), y la parte transparente
// deja pasar los clics al escritorio con setIgnoreMouseEvents (el renderer decide cuándo,
// según si el ratón está sobre algo interactivo). Sin material acrílico: acrílico rellena
// toda la ventana de gris aunque el DOM sea transparente (era el "recuadro gris raro").
// La ventana del dock cubre TODA el área de trabajo de la pantalla elegida y es
// transparente + click-through: así la posición de la barra (cualquiera de los 4 bordes
// o de las 4 esquinas), el tamaño del panel y las animaciones son puro CSS, sin tener
// que recalcular ni redimensionar la ventana (que era lo que iba a tirones).
const DOCK_ANCHORS = ['left','right','top','bottom'];

// Huella de una pantalla, para reconocerla aunque vuelva con otro id (Windows los
// reasigna al desconectar y volver a conectar un monitor).
function displayKey(d) {
  if (!d) return null;
  return `${d.bounds.width}x${d.bounds.height}@${d.bounds.x},${d.bounds.y}:${d.scaleFactor}`;
}

// La pantalla donde vive la barra flotante. Si la elegida no está conectada ahora
// mismo, se usa la que haya, PERO no se toca el ajuste: en cuanto vuelva a aparecer,
// la barra se va sola otra vez a ella.
function dockDisplay() {
  const displays = screen.getAllDisplays();
  if (settings.dockDisplayId != null) {
    const porId = displays.find(x => x.id === settings.dockDisplayId);
    if (porId) return porId;
    if (settings.dockDisplayKey) {
      const porHuella = displays.find(x => displayKey(x) === settings.dockDisplayKey);
      if (porHuella) return porHuella;
    }
  }
  return getReferenceDisplay();
}

// Config visual del dock que se envía al renderer (anclaje, colores, tamaños...).
function dockConfig() {
  const anchor = DOCK_ANCHORS.includes(settings.dockAnchor) ? settings.dockAnchor : 'right';
  return {
    anchor,
    barWidth: Math.max(3, Math.min(24, Number(settings.dockBarWidth) || 7)),
    barLength: Math.max(30, Math.min(600, Number(settings.dockBarLength) || 110)),
    barPos: Math.max(0, Math.min(100, settings.dockBarPos == null ? 50 : Number(settings.dockBarPos))),
    barOffset: Math.max(0, Math.min(120, settings.dockBarOffset == null ? 4 : Number(settings.dockBarOffset))),
    barOpacity: Math.max(5, Math.min(100, Number(settings.dockBarOpacity) || 30)),
    barColor: settings.dockBarColor || '#ffffff',
    barGlass: settings.dockBarGlass !== false,   // 2.8.3: de cristal (por defecto)
    panelWidth: Math.max(320, Math.min(1600, Number(settings.dockPanelWidth) || 460)),
    panelHeight: Math.max(260, Math.min(1400, Number(settings.dockPanelHeight) || 620)),
    calendarWidth: Math.max(420, Math.min(1900, Number(settings.dockCalendarWidth) || 1180)),
    closeMode: ['button','clickOutside','mouseLeave'].includes(settings.dockCloseMode) ? settings.dockCloseMode : 'button',
    closeSeconds: Math.max(0, Math.min(30, Number(settings.dockCloseSeconds) ?? 3)),
  };
}

// Toda el área de trabajo de la pantalla elegida (ventana de la barrita).
function computeDockBounds() {
  const work = dockDisplay().workArea;
  return { x: work.x, y: work.y, width: work.width, height: work.height };
}

// Dónde va el panel: pegado a su borde, ocupando todo el largo de ese borde.
// Lo que mide la tarjeta del panel en una vista: el ancho con la barra a un lado (el
// calendario es más ancho) o el alto con la barra arriba/abajo.
function tamPanelVista(view) {
  const c = dockConfig();
  if (c.anchor === 'left' || c.anchor === 'right') return view === 'calendar' ? c.calendarWidth : c.panelWidth;
  return c.panelHeight;
}
// Rectángulo en pantalla de una tarjeta de ese tamaño, pegada a su borde.
function rectPanel(size) {
  const work = dockDisplay().workArea;
  const c = dockConfig();
  if (c.anchor === 'left' || c.anchor === 'right') {
    const width = Math.max(1, Math.min(Math.round(size), work.width));
    return { x: c.anchor === 'left' ? work.x : work.x + work.width - width, y: work.y, width, height: work.height };
  }
  const height = Math.max(1, Math.min(Math.round(size), work.height));
  return { x: work.x, y: c.anchor === 'top' ? work.y : work.y + work.height - height, width: work.width, height };
}
function computePanelBounds(view) { return rectPanel(tamPanelVista(view)); }

// ── Ventana del panel (rehecha en la 2.8.3) ─────────────────────────────────────
// La ventana cubre SIEMPRE el área de trabajo de su pantalla, igual que la de la barrita,
// y NO se mueve ni cambia de tamaño mientras se ve: redimensionar una ventana transparente
// visible en Windows pinta un fotograma viejo desplazado (el "parpadeo"). Todo lo que se
// ve (entrar, cambiar de pestaña y de ancho, redimensionar a mano) lo anima la página, que
// es la única dueña del tamaño de la tarjeta y lo comunica con 'dock-panel-rect'. Aquí solo
// se recorta la ventana a la tarjeta (setShape: lo de fuera deja pasar los clics) y se
// coloca el botón de esconder.
let dockPanelRect = null;   // dónde está la tarjeta (en pantalla), según la página

function formaRedondeada(x, y, w, h, radios) {
  x = Math.round(x); y = Math.round(y); w = Math.round(w); h = Math.round(h);
  if (!(w > 0 && h > 0)) return [{ x: 0, y: 0, width: 1, height: 1 }];   // nada visible
  const max = Math.floor(Math.min(w, h) / 2);
  const [tl, tr, br, bl] = (radios || [0, 0, 0, 0]).map(r => Math.max(0, Math.min(Math.round(Number(r) || 0), max)));
  const entra = (r, i) => (i < r ? Math.ceil(r - Math.sqrt(Math.max(0, r * r - (r - i - 0.5) * (r - i - 0.5)))) : 0);
  const arriba = Math.max(tl, tr), abajo = Math.max(bl, br);
  const filas = [];
  for (let i = 0; i < arriba; i++) { const a = entra(tl, i), b = entra(tr, i); filas.push({ x: x + a, y: y + i, width: w - a - b, height: 1 }); }
  filas.push({ x, y: y + arriba, width: w, height: h - arriba - abajo });
  for (let i = abajo - 1; i >= 0; i--) { const a = entra(bl, i), b = entra(br, i); filas.push({ x: x + a, y: y + h - 1 - i, width: w - a - b, height: 1 }); }
  // Filas seguidas con el mismo ancho se juntan en un solo rectángulo.
  const juntas = [];
  for (const r of filas) {
    if (!(r.width > 0 && r.height > 0)) continue;
    const u = juntas[juntas.length - 1];
    if (u && u.x === r.x && u.width === r.width && u.y + u.height === r.y) u.height += r.height;
    else juntas.push({ ...r });
  }
  return juntas.length ? juntas : [{ x: 0, y: 0, width: 1, height: 1 }];
}
function ajustarVentanaPanel() {
  const w = dockPanelWin;
  if (!w || w.isDestroyed()) return false;
  const want = computeDockBounds();
  let cur;
  try { cur = w.getBounds(); } catch { return false; }
  if (cur.x === want.x && cur.y === want.y && cur.width === want.width && cur.height === want.height) return false;
  try { w.setBounds(want); } catch {}
  w.__forma = null;   // la forma va relativa a la ventana: hay que volver a ponerla
  return true;
}
function aplicarFormaPanel(size) {
  const w = dockPanelWin;
  if (!w || w.isDestroyed() || !(size > 0)) return;
  const r = rectPanel(size), b = computeDockBounds();   // b: los límites que tiene (o va a tener) la ventana
  const forma = { x: r.x - b.x, y: r.y - b.y, width: r.width, height: r.height };
  const clave = JSON.stringify(forma);
  if (clave === w.__forma) return;   // sin cambios: ni se toca (cada setShape repinta)
  w.__forma = clave;
  try { w.setShape([forma]); } catch {}
}

let dockPanelView = 'panel';
let dockPanelShownAt = 0;   // cuándo se mostró el panel (ver el blur de clic-fuera)

function createDockPanel() {
  if (dockPanelWin && !dockPanelWin.isDestroyed()) return;
  dockPanelWin = new BrowserWindow({
    ...computeDockBounds(),
    show: false,
    frame: false, hasShadow: false,
    // 2.8: TRANSPARENTE y sin acrílico. Con el acrílico Windows solo deja esquinas de 8 px
    // (y se veían dos esquinas: la de la ventana y la del panel), y para desvanecerla había
    // que usar setOpacity, que en Windows la convierte en ventana "en capas" para siempre:
    // a partir de ahí dejaba de pintar las animaciones (por eso las pestañas no se
    // animaban). Ahora el panel es una tarjeta de la página, con las esquinas que quiera, y
    // todas sus animaciones (entrar, salir, cambiar de ancho) las hace la propia página.
    transparent: true, backgroundColor: '#00000000',
    resizable: false, movable: false, skipTaskbar: true, alwaysOnTop: true, roundedCorners: false,
    icon: WINDOW_ICON_PATH,
    // Sin backgroundThrottling:false: plegado está oculto y no debe pintar (ver makeWindow).
    webPreferences: { nodeIntegration: true, contextIsolation: false, nodeIntegrationInSubFrames: true },
  });
  try { dockPanelWin.setAlwaysOnTop(true, 'screen-saver'); } catch {}   // igual que la barra
  dockPanelWin.loadFile(path.join(__dirname, 'src', 'dock-panel.html'));
  const push = () => {
    try { dockPanelWin.webContents.send('dock-config', dockConfig()); } catch {}
    sendStateToWindow(dockPanelWin);
  };
  if (dockPanelWin.webContents.isLoading()) dockPanelWin.webContents.once('did-finish-load', push);
  else push();
  // Clic fuera = el panel pierde el foco. Con dos salvaguardas, porque si no el panel se
  // cerraba justo al abrirse: (1) un margen desde que se muestra, porque al aparecer aún
  // no tiene el foco asentado y salta un blur; y (2) si el foco ha ido a otra ventana de
  // la propia app (Ajustes, el aviso de actualización...), eso no es "clicar fuera".
  dockPanelWin.on('blur', () => {
    if (settings.dockCloseMode !== 'clickOutside' || !dockExpanded) return;
    if (Date.now() - dockPanelShownAt < 700) return;
    setTimeout(() => {
      if (settings.dockCloseMode !== 'clickOutside' || !dockExpanded) return;
      const f = BrowserWindow.getFocusedWindow();
      if (f && !f.isDestroyed()) return;   // el foco sigue dentro de la app
      collapseDockPanel();
    }, 140);
  });
  dockPanelWin.on('closed', () => { dockPanelWin = null; dockPanelRect = null; });
  aplicarFormaPanel(tamPanelVista(dockPanelView));
  dockPanelWin.webContents.on('render-process-gone', () => {
    try { if (dockPanelWin && !dockPanelWin.isDestroyed()) dockPanelWin.destroy(); } catch {}
    dockPanelWin = null; dockExpanded = false; hideDockHide(); ensureDockBarVisible();
  });
}

// El botón de esconder ya no tiene ventana propia: se pinta dentro de la de la barra
// (ver .hide-btn en dock.html), que es la que ya tenía un sistema de zonas clicables que
// funciona. Aquí solo queda su tamaño, para calcular dónde va su centro.
const HIDE_BTN = 34;

// Le dice a la ventana de la barra dónde pintar el botón: el CENTRO del círculo, en
// coordenadas de esa ventana (cubre toda el área de trabajo, así que basta con restarle
// su origen). El destino se recibe como parámetro y NO se relee con getBounds(): justo
// después de un setBounds, Windows devuelve a veces los límites anteriores, y ese era el
// motivo de que el botón acabara colocado respecto a un panel que ya no existía.
function positionDockHide(panelBounds) {
  if (!dockWin || dockWin.isDestroyed() || !panelBounds) return;
  const b = panelBounds;
  let origen;
  try { origen = dockWin.getBounds(); } catch { return; }
  const gap = 12, r = HIDE_BTN / 2;
  const anchor = dockConfig().anchor;
  let cx, cy;
  if (anchor === 'right')       { cx = b.x - gap - r;            cy = b.y + b.height / 2; }
  else if (anchor === 'left')   { cx = b.x + b.width + gap + r;  cy = b.y + b.height / 2; }
  else if (anchor === 'top')    { cy = b.y + b.height + gap + r; cx = b.x + b.width / 2; }
  else                          { cy = b.y - gap - r;            cx = b.x + b.width / 2; }
  try {
    dockWin.webContents.send('dock-hide-btn', {
      visible: true,
      x: Math.round(cx - origen.x),
      y: Math.round(cy - origen.y),
    });
  } catch {}
}

function showDockHide(panelBounds) {
  positionDockHide(panelBounds);   // se pasa el destino conocido, NO se relee con getBounds()
}
function hideDockHide() {
  if (!dockWin || dockWin.isDestroyed()) return;
  try { dockWin.webContents.send('dock-hide-btn', { visible: false }); } catch {}
}

// La barrita tiene que estar SIEMPRE visible y con las medidas del área de trabajo. Si la
// ventana se creó cuando el escritorio aún se montaba (arranque con Windows) o cambian los
// monitores, sus medidas se quedan viejas: entonces su "borde derecho" cae en mitad de la
// pantalla física (la barrita aparece flotando en medio) o directamente fuera (desaparece).
// ¿Está la barra escondida a propósito ahora mismo? -1 es "hasta que yo la muestre";
// un número mayor que cero es el momento en el que vuelve sola.
function dockIsHidden() {
  const h = Number(settings.dockHiddenUntil) || 0;
  if (h === -1) return true;
  if (h > Date.now()) return true;
  if (h !== 0) { settings.dockHiddenUntil = 0; saveSettings(); }   // ya venció
  return false;
}

// minutos = 0 la esconde hasta que se pida mostrarla; null la vuelve a mostrar.
function hideDockFor(minutos) {
  if (minutos === null) settings.dockHiddenUntil = 0;
  else if (!minutos) settings.dockHiddenUntil = -1;
  else settings.dockHiddenUntil = Date.now() + minutos * 60000;
  saveSettings();
  if (dockIsHidden()) {
    collapseDockPanel();
    try { if (dockWin && !dockWin.isDestroyed()) dockWin.hide(); } catch {}
  } else {
    ensureDockBarVisible();
  }
  updateTrayTitle();
}

// Las tres ventanas del dock viven en el mismo nivel ('screen-saver'), asi que quien
// se reafirma el ultimo queda arriba. Reafirmar el de la barra cada pocos segundos
// (lo que la mantiene por encima de lo que va a pantalla completa) la ponia por encima
// del panel y de su boton de esconder, y el boton dejaba de recibir los clics. Aqui se
// vuelve a dejar el orden que toca: barra, luego panel, luego boton.
function restackDock() {
  // CON EL PANEL ABIERTO NO SE TOCA EL ORDEN DE VENTANAS. Reafirmar el nivel vuelve a
  // subir la ventana, y la lista de un <select> abierto es una ventana aparte del
  // sistema: al resubir las nuestras, la lista se queda debajo y parece que el
  // desplegable se cierra solo en cuanto pasas el ratón por las opciones.
  //
  // Esta reafirmación existe para que la barrita no se quede detrás de lo que va a
  // pantalla completa, y ese caso es justo el contrario: ahí el panel está cerrado. Así
  // que con el panel abierto no hace falta y sobra.
  if (dockExpanded) return;
  try { if (dockWin && !dockWin.isDestroyed()) dockWin.setAlwaysOnTop(true, 'screen-saver'); } catch {}
}

function ensureDockBarVisible() {
  if (!settings.dockMode) return;
  createDock();
  if (!dockWin || dockWin.isDestroyed()) return;
  // Escondida a propósito: el vigilante no debe sacarla otra vez.
  if (dockIsHidden()) { try { if (dockWin.isVisible()) dockWin.hide(); } catch {} return; }
  try { if (!dockWin.isVisible()) dockWin.showInactive(); } catch {}
  restackDock();
  syncDockBounds();
}

function syncDockBounds() {
  if (!dockWin || dockWin.isDestroyed()) return;
  let cur, want;
  try { cur = dockWin.getBounds(); want = computeDockBounds(); } catch { return; }
  if (cur.x !== want.x || cur.y !== want.y || cur.width !== want.width || cur.height !== want.height) {
    try { dockWin.setBounds(want); } catch {}
  }
  // El panel solo se recoloca si cambió la pantalla bajo sus pies (su ventana mide siempre
  // el área de trabajo). La página lo nota (resize) y vuelve a decir dónde está su tarjeta.
  ajustarVentanaPanel();
}

// 2.8: la ventana (transparente) se coloca y se enseña ya en su sitio, y es la página la
// que hace entrar el panel deslizándolo desde el borde (ver dock-panel.html). Mientras
// estaba escondido el panel se quedó fuera de la vista, así que al enseñar la ventana no
// se ve nada hasta que entra.
function showDockPanel() {
  createDockPanel();
  if (!dockPanelWin || dockPanelWin.isDestroyed()) return;
  ajustarVentanaPanel();
  if (!dockPanelRect) aplicarFormaPanel(tamPanelVista(dockPanelView));   // la página la afina al entrar
  const wasVisible = dockPanelWin.isVisible();
  // Oculto está frenado y puede llevar un fotograma viejo: el estado al día antes de verse.
  if (!wasVisible) sendStateToWindow(dockPanelWin);
  dockPanelWin.__salida = (dockPanelWin.__salida || 0) + 1;   // anula una salida a medias
  try {
    dockPanelWin.showInactive(); dockPanelWin.moveTop(); dockPanelWin.focus();
  } catch {}
  dockExpanded = true; dockOutsideSince = 0; dockPanelShownAt = Date.now();
  // 2.8.3: el botón de esconder sale cuando el panel empieza a entrar (con cristal, la página
  // espera a tener la foto de detrás), no antes. Por si no avisa, a los 450 ms.
  const turno = dockPanelWin.__salida;
  dockPanelWin.__botonPendiente = () => {
    if (!dockPanelWin || dockPanelWin.isDestroyed() || dockPanelWin.__salida !== turno || !dockExpanded) return;
    dockPanelWin.__botonPendiente = null;
    showDockHide(dockPanelRect || computePanelBounds(dockPanelView));
  };
  setTimeout(() => { if (dockPanelWin && dockPanelWin.__botonPendiente) dockPanelWin.__botonPendiente(); }, 450);
  try { dockPanelWin.webContents.send('panel-entrar'); } catch {}
  sendToAllFrames(dockPanelWin, 'dock-expanded');
}

// La página saca el panel deslizándolo hacia el borde y avisa ('dock-panel-salido');
// entonces se esconde la ventana. Si vuelve a abrirse a medio camino, no se esconde.
function collapseDockPanel() {
  dockExpanded = false; dockOutsideSince = 0;
  if (dockWin && !dockWin.isDestroyed()) { try { dockWin.webContents.send('dock-collapse'); } catch {} }
  if (!dockPanelWin || dockPanelWin.isDestroyed() || !dockPanelWin.isVisible()) { hideDockHide(); return; }
  hideDockHide();
  const token = (dockPanelWin.__salida = (dockPanelWin.__salida || 0) + 1);
  const esconder = () => {
    if (!dockPanelWin || dockPanelWin.isDestroyed() || dockPanelWin.__salida !== token || dockExpanded) return;
    dockPanelWin.__alSalir = null;
    try { dockPanelWin.hide(); } catch {}
    ensureDockBarVisible();   // al cerrarse el panel, la barrita tiene que estar ahí
  };
  dockPanelWin.__alSalir = esconder;
  try { dockPanelWin.webContents.send('panel-salir'); } catch {}
  setTimeout(esconder, 420);   // por si la página no llega a avisar
}

// Empuja la config visual al renderer del dock (al crearlo y al cambiar Ajustes).
function sendDockConfig() {
  const cfg = dockConfig();
  [dockWin, dockPanelWin].forEach(w => {
    if (!w || w.isDestroyed()) return;
    const send = () => { try { w.webContents.send('dock-config', cfg); } catch {} };
    if (w.webContents.isLoading()) w.webContents.once('did-finish-load', send);
    else send();
  });
  ajustarVentanaPanel();   // por si cambió de pantalla
}

// Decide si el dock captura el ratón o deja pasar los clics al escritorio, mirando dónde
// está el cursor de verdad. Se hace desde el proceso principal (y no con mousemove en la
// página) porque el ratón sobre un iframe NO genera eventos en el documento que lo
// contiene: al entrar directo sobre el calendario, la ventana se quedaba en modo "dejar
// pasar los clics" y no se podía pulsar nada.
function setDockIgnore(ignore) {
  if (ignore === dockIgnoring) return;
  dockIgnoring = ignore;
  if (dockWin && !dockWin.isDestroyed()) {
    try { dockWin.setIgnoreMouseEvents(ignore); } catch {}
  }
}

function updateDockHitTest() {
  if (!dockWin || dockWin.isDestroyed()) return;
  let p, b;
  try { p = screen.getCursorScreenPoint(); b = dockWin.getBounds(); } catch { return; }
  const x = p.x - b.x, y = p.y - b.y;
  const inside = dockHitRects.some(r => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h);
  setDockIgnore(!inside);

  // Revelado de la barrita al acercarse: se calcula aquí porque la ventana ya no recibe
  // los movimientos del ratón (ese reenvío era lo que hacía parpadear el cursor).
  const radio = Math.max(10, Math.min(200, Number(settings.dockNearDistance) || 45));
  const near = !dockExpanded && !!dockBarRect &&
    Math.hypot(Math.max(dockBarRect.x - x, 0, x - (dockBarRect.x + dockBarRect.w)),
               Math.max(dockBarRect.y - y, 0, y - (dockBarRect.y + dockBarRect.h))) < radio;
  if (near !== dockBarNear) {
    dockBarNear = near;
    try { dockWin.webContents.send('dock-bar-near', near); } catch {}
  }

  // Auto-esconder cuando el cursor lleva un rato fuera del panel abierto. El panel es
  // ahora otra ventana, así que "dentro" incluye también sus límites (si no, contaría
  // como fuera en cuanto el ratón entrase en el propio panel).
  if (dockExpanded && settings.dockCloseMode === 'mouseLeave') {
    let overPanel = false;
    if (dockPanelWin && !dockPanelWin.isDestroyed() && dockPanelWin.isVisible()) {
      const pb = dockPanelRect || computePanelBounds(dockPanelView);
      overPanel = p.x >= pb.x && p.x <= pb.x + pb.width && p.y >= pb.y && p.y <= pb.y + pb.height;
    }
    if (inside || overPanel) dockOutsideSince = 0;
    else {
      const now = Date.now();
      if (!dockOutsideSince) dockOutsideSince = now;
      else if (now - dockOutsideSince >= (Number.isFinite(Number(settings.dockCloseSeconds)) ? Number(settings.dockCloseSeconds) : 3) * 1000) {
        dockOutsideSince = 0;
        collapseDockPanel();
      }
    }
  } else {
    dockOutsideSince = 0;
  }
}

function createDock() {
  if (dockWin && !dockWin.isDestroyed()) return;
  dockWin = new BrowserWindow({
    ...computeDockBounds(),
    frame: false, transparent: true, hasShadow: false, backgroundColor: '#00000000',
    resizable: false, movable: false, skipTaskbar: true, alwaysOnTop: true,
    roundedCorners: false, focusable: true,
    icon: WINDOW_ICON_PATH,
    webPreferences: { nodeIntegration: true, contextIsolation: false, nodeIntegrationInSubFrames: true , backgroundThrottling: false},
  });
  dockExpanded = false;
  // Sin acrílico ni insertCSS de --bg: la ventana es transparente de verdad; el panel del
  // dock pinta su propio fondo. Arranca dejando pasar los clics (solo la barra captura).
  dockHitRects = []; dockIgnoring = null;
  setDockIgnore(true);
  if (dockHitTimer) clearInterval(dockHitTimer);
  dockHitTimer = setInterval(updateDockHitTest, 60);
  // 'screen-saver' es el nivel que queda por encima de las aplicaciones a pantalla
  // completa. Con el alwaysOnTop normal, un juego o un vídeo maximizado se ponía
  // delante y la barra desaparecía. La ventana es click-through salvo en la barra,
  // así que estar tan arriba no molesta a nada.
  try { dockWin.setAlwaysOnTop(true, 'screen-saver'); } catch {}
  dockWin.loadFile(path.join(__dirname, 'src', 'dock.html'));
  sendDockConfig();
  dockWin.once('ready-to-show', () => { if (dockWin && !dockWin.isDestroyed()) dockWin.showInactive(); });
  // El clic fuera se detecta en la ventana del PANEL (ver createDockPanel): esta ventana
  // es la de la barrita y no tiene foco propio.
  dockWin.on('closed', () => {
    if (dockHitTimer) { clearInterval(dockHitTimer); dockHitTimer = null; }
    dockWin = null; dockExpanded = false; dockHitRects = []; dockIgnoring = null;
  });

  // Red de seguridad: la ventana cubre toda el área de trabajo, y quien decide si los
  // clics pasan al escritorio es el renderer. Si el renderer se cuelga o se muere, esa
  // decisión deja de actualizarse, así que forzamos click-through (y si ha muerto del
  // todo, salimos del modo dock) para no dejar la pantalla bloqueada.
  dockWin.webContents.on('unresponsive', () => {
    try { dockWin.setIgnoreMouseEvents(true); } catch {}
  });
  dockWin.webContents.on('render-process-gone', () => {
    destroyDock();
    settings.dockMode = false; saveSettings(); updateTrayTitle();
    openMain();
  });
}

function destroyDock() {
  if (dockPanelWin && !dockPanelWin.isDestroyed()) dockPanelWin.close();
  dockPanelWin = null;
  if (dockHitTimer) { clearInterval(dockHitTimer); dockHitTimer = null; }
  if (dockWin && !dockWin.isDestroyed()) dockWin.close();
  dockWin = null; dockExpanded = false; dockHitRects = []; dockIgnoring = null;
}

// Reposiciona el dock y le reenvía la config (pantalla, lado, grosor, color...).
function positionDock() {
  if (!dockWin || dockWin.isDestroyed()) return;
  try { dockWin.setBounds(computeDockBounds()); } catch {}
  sendDockConfig();
}

// Recuerda por dónde andaba el usuario para volver a abrir ahí (ver openLastView).
// Ajustes no cuenta: no es una "pestaña" a la que tenga sentido volver al arrancar.
function rememberView(view) {
  if (view !== 'panel' && view !== 'calendar') return;   // Guardadas/Ajustes no se recuerdan
  if (settings.lastView === view) return;
  settings.lastView = view;
  saveSettingsSoon();
}

// Abre la app por donde se quedó la última vez (panel, calendario o guardadas).
function openLastView() {
  checkForUpdatesIfStale();
  const v = settings.lastView;   // se lee ANTES: openMain() lo sobrescribe con 'panel'
  if (settings.dockMode) { dockNavigate(v && v !== 'settings' ? v : 'panel'); return; }
  // En modo ventanas el panel se abre SIEMPRE: es el único sitio con los botones para
  // navegar. Si no, al recordar "Guardadas" o "Calendario" se abría solo esa ventana y no
  // había forma de volver (y al cerrarla no quedaba nada visible: parecía que la app se
  // rompía). La vista recordada se abre encima del panel.
  openMain();
  if (v === 'calendar') openCalendar();
}

// Evita quedarse sin ninguna ventana a la vista al cerrar el calendario o Guardadas.
function ensureSomeWindowVisible() {
  if (settings.dockMode) return;
  const anyVisible = [mainWin, calendarWin, groupsWin]
    .some(w => w && !w.isDestroyed() && w.isVisible());
  if (!anyVisible) openMain();
}

// Enseña una vista dentro del dock (en vez de abrir una ventana suelta).
function dockNavigate(view) {
  checkForUpdatesIfStale();
  rememberView(view);
  if (!dockWin || dockWin.isDestroyed()) createDock();
  dockPanelView = view;
  showDockPanel();
  const send = () => { try { dockPanelWin.webContents.send('dock-navigate', view); } catch {} };
  if (dockPanelWin.webContents.isLoading()) dockPanelWin.webContents.once('did-finish-load', send);
  else send();
  if (dockWin && !dockWin.isDestroyed()) { try { dockWin.webContents.send('dock-expand'); } catch {} }
}

// Aplica el modo dock al cambiarlo en Ajustes (o al arrancar). wasDock = estado anterior.
function applyDockMode(wasDock) {
  if (settings.dockMode) {
    // Al entrar en modo dock, escondemos las ventanas sueltas y creamos la barra.
    [mainWin, calendarWin, groupsWin, settingsWin].forEach(w => { try { if (w && !w.isDestroyed()) w.hide(); } catch {} });   // escondidas (no cerradas) para que, al salir del dock, vuelvan con su tamaño y sitio; con el frenado por defecto no pintan
    createDock();
    if (!wasDock) dockNavigate('panel');
    else positionDock();   // reajusta a la pantalla elegida
  } else if (wasDock) {
    destroyDock();
    openMain();
  }
}

function openMain() {
  checkForUpdatesIfStale();   // aprovecha que el usuario vuelve a la app para refrescar, sin esperar al temporizador
  if (settings.dockMode) { dockNavigate('panel'); return; }
  rememberView('panel');
  if (mainWin && !mainWin.isDestroyed()) { mainWin.show(); mainWin.focus(); sendStateToWindow(mainWin); return; }
  mainWin = makeWindow('main.html', 560, 660, {
    minWidth: 380, minHeight: 480,
    maxWidth: 900, maxHeight: 1000,
  });
  mainWin.once('ready-to-show', () => { mainWin.show(); sendStateToWindow(mainWin); });
  mainWin.on('closed', () => { mainWin = null; });
}

function createSplash() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  const S = 300;
  splashWin = new BrowserWindow({
    width: S, height: S,
    x: Math.round((width - S) / 2), y: Math.round((height - S) / 2),
    frame: false, transparent: true, hasShadow: false, backgroundColor: '#00000000',
    resizable: false, movable: false, alwaysOnTop: true, skipTaskbar: true,
    show: false,
    icon: WINDOW_ICON_PATH,
    webPreferences: { nodeIntegration: true, contextIsolation: false },
  });
  splashWin.loadFile(path.join(__dirname, 'src', 'splash.html'));
  splashWin.once('ready-to-show', () => splashWin.show());
  return splashWin;
}

function showSplashThenMain() {
  const splash = createSplash();
  let closed = false;
  const closeSplash = () => {
    if (closed) return; closed = true;
    if (!splash || splash.isDestroyed()) return;
    try { splash.webContents.send('leave'); } catch {}
    setTimeout(() => { if (splash && !splash.isDestroyed()) splash.close(); }, 340);
  };
  setTimeout(() => {
    openLastView();
    const first = mainWin || calendarWin || groupsWin;
    if (first && !first.isDestroyed()) first.once('show', closeSplash);
    else closeSplash();
    // Cierre de seguridad: pase lo que pase (si 'show' no llega, la ventana tarda,
    // etc.) el splash nunca se queda enganchado.
    setTimeout(closeSplash, 2500);
  }, 3500);
}

function openCalendar() {
  if (settings.dockMode) { dockNavigate('calendar'); return; }
  checkForUpdatesIfStale();
  rememberView('calendar');
  if (calendarWin && !calendarWin.isDestroyed()) { calendarWin.show(); calendarWin.focus(); sendStateToWindow(calendarWin); return; }
  calendarWin = makeWindow('calendar.html', 1280, 760, {
    minWidth: 760, minHeight: 520,
    maxWidth: 1600, maxHeight: 1000,
  });
  calendarWin.once('ready-to-show', () => { calendarWin.show(); sendStateToWindow(calendarWin); });
  calendarWin.on('closed', () => { calendarWin = null; });
}

function openSettings() {
  if (settings.dockMode) { dockNavigate('settings'); return; }
  if (settingsWin && !settingsWin.isDestroyed()) { settingsWin.show(); settingsWin.focus(); return; }
  settingsWin = makeWindow('settings.html', 430, 720, {
    minWidth: 380, minHeight: 420,
    maxWidth: 560, maxHeight: 900,
  });
  settingsWin.once('ready-to-show', () => { settingsWin.show(); settingsWin.webContents.send('settings', settings); });
  settingsWin.on('closed', () => { settingsWin = null; });
}

function openGroups() {
  if (settings.dockMode) { dockNavigate('groups'); return; }
  checkForUpdatesIfStale();
  rememberView('groups');
  if (groupsWin && !groupsWin.isDestroyed()) { groupsWin.show(); groupsWin.focus(); sendStateToWindow(groupsWin); return; }
  groupsWin = makeWindow('groups.html', 420, 620, {
    minWidth: 340, minHeight: 420,
    maxWidth: 700, maxHeight: 1000,
  });
  groupsWin.once('ready-to-show', () => { groupsWin.show(); sendStateToWindow(groupsWin); });
  groupsWin.on('closed', () => { groupsWin = null; });
}

function openSync() {
  if (syncWin && !syncWin.isDestroyed()) { syncWin.show(); syncWin.focus(); return; }
  syncWin = makeWindow('sync.html', 400, 520, { minWidth: 360, minHeight: 460, maxWidth: 520, maxHeight: 680 });
  syncWin.once('ready-to-show', () => { syncWin.show(); syncWin.webContents.send('sync-status', syncStatus); });
  syncWin.on('closed', () => { syncWin = null; });
}

// Ventana de actualización con el estilo de la app (sustituye a los diálogos nativos,
// que quedaban ocultos tras el splash). Su contenido cambia según el estado que le
// envía el auto-updater vía 'update-state'.
function openUpdateWindow() {
  if (updateWin && !updateWin.isDestroyed()) { updateWin.show(); updateWin.focus(); return; }
  updateWin = makeWindow('update.html', 400, 320, {
    alwaysOnTop: true, resizable: false,
    minWidth: 360, minHeight: 280, maxWidth: 460, maxHeight: 380,
  });
  updateWin.once('ready-to-show', () => {
    updateWin.show(); updateWin.focus();
    try { updateWin.moveTop(); } catch {}
    if (pendingUpdateState) updateWin.webContents.send('update-state', pendingUpdateState);
  });
  updateWin.on('closed', () => { updateWin = null; });
}

// ── Novedades al actualizar ───────────────────────────────────────────────────
function openWhatsNew() {
  if (whatsNewWin && !whatsNewWin.isDestroyed()) { whatsNewWin.show(); whatsNewWin.focus(); return; }
  whatsNewWin = makeWindow('whatsnew.html', 440, 430, {
    alwaysOnTop: true, resizable: false,
    minWidth: 400, minHeight: 380, maxWidth: 520, maxHeight: 520,
  });
  whatsNewWin.once('ready-to-show', () => {
    whatsNewWin.show(); whatsNewWin.focus();
    try { whatsNewWin.moveTop(); } catch {}
  });
  whatsNewWin.on('closed', () => { whatsNewWin = null; });
}

// Se enseña una sola vez por versión y SOLO en el canal estable: en el de prueba salen
// versiones a diario y sería un incordio verlo cada vez.
function whatsNewSignature(notes) {
  if (!notes) return '';
  return (notes.steps || []).map(s => s.title).join('|');
}

function maybeShowWhatsNew() {
  const v = app.getVersion();
  if (settings.lastSeenVersion === v) return;
  // Lo que decide si hay recorrido es que ESA versión tenga novedades escritas, y solo
  // las estables las tienen. Antes se descartaba además a quien tuviera Betatester
  // activado, y eso también le ocultaba las novedades de las estables, que es justo lo
  // que había que enseñar.
  const notes = WHATS_NEW[v];
  const sig = whatsNewSignature(notes);
  const yaVisto = !!sig && sig === settings.lastSeenWhatsNew;
  settings.lastSeenVersion = v;      // se marca aunque no haya notas, para no reintentarlo
  if (sig) settings.lastSeenWhatsNew = sig;
  saveSettings();
  // Si la versión nueva cuenta exactamente lo mismo que la anterior, no se repite:
  // ya se leyó una vez y volver a soltarlo entero es justo lo que molestaba.
  if (!notes || yaVisto) return;
  setTimeout(() => openWhatsNew(), 1200);   // tras el arranque, sin pisar al splash
}

function sendUpdateState(state) {
  pendingUpdateState = state;
  if (updateWin && !updateWin.isDestroyed()) updateWin.webContents.send('update-state', state);
}

// ── IPC ───────────────────────────────────────────────────────────────────────
function getSerializableState() {
  return {
    tasks: state.tasks.map(t => {
      const hoy0 = new Date(); hoy0.setHours(0, 0, 0, 0);
      return {
        ...t,
        todaySecs: todaySecondsForTask(t),
        totalSecs: totalSecondsForTask(t),
        inTrash: isInTrash(t),   // para la sección "Papelera" de Guardadas
        inactive: isInactiveTask(t),   // para la sección "Archivador" de Guardadas
        subtasks: (t.subtasks || []).map(sub => ({
          ...sub,
          todaySecs: secondsForSub(t, sub.id, hoy0.getTime()),
          totalSecs: secondsForSub(t, sub.id, null),
        })),
        // Tiempo apuntado a la tarea sin subtarea ninguna, para que la suma cuadre.
        ownTodaySecs: secondsForSub(t, null, hoy0.getTime()),
      };
    }),
    groups: sortedGroups(),
    palettes: GROUP_PALETTES,
    activeTaskId: state.activeTaskId,
    activeSubId: state.activeSubId || null,
    todayTotal: totalTodaySeconds(),
    settings,
    updateAvailable: updateInfo,
    trashRetentionDays: TRASH_RETENTION_DAYS,
  };
}

// webContents.send() SOLO llega al frame principal. En modo dock las vistas (panel,
// calendario, guardadas, ajustes) viven en un iframe, así que sin reenviar a los
// sub-frames se quedaban con el estado del momento en que cargaron: las acciones se
// ejecutaban de verdad pero la interfaz no se refrescaba nunca (parecía que restaurar,
// eliminar de la papelera o reanudar una tarea "no hacían nada").
// Avisa a TODAS las vistas de que hay un recorrido en marcha. Hace falta además de la
// respuesta a 'am-i-visible' porque, si la vista de destino ya era la que estaba
// abierta, el iframe no se recarga y esa página nunca llega a preguntar.
function broadcastTourFlag() {
  [dockPanelWin, mainWin, calendarWin, groupsWin, settingsWin].forEach(w => {
    if (w && !w.isDestroyed()) sendToAllFrames(w, 'tutorial-tour');
  });
}

function sendToAllFrames(win, channel, payload) {
  if (!win || win.isDestroyed()) return;
  try { win.webContents.send(channel, payload); } catch {}
  try {
    (win.webContents.mainFrame.frames || []).forEach(f => { try { f.send(channel, payload); } catch {} });
  } catch {}
}

function sendStateToWindow(win) {
  if (!win || win.isDestroyed()) return;
  sendToAllFrames(win, 'state', getSerializableState());
}

// Vista del dock que se ve ahora. Desde la 2.8 las cuatro viven a la vez (una por
// iframe): solo la visible recibe el estado de cada segundo, y la que entra lo recibe al
// momento al cambiar de pestaña (ver 'dock-view-changed').
const DOCK_VIEW_FILE = { panel: 'main.html', calendar: 'calendar.html', groups: 'groups.html', settings: 'settings.html' };
function activeDockFrames() {
  if (!dockPanelWin || dockPanelWin.isDestroyed()) return [];
  let todos = [];
  try { todos = dockPanelWin.webContents.mainFrame.frames || []; } catch { return []; }
  const fichero = DOCK_VIEW_FILE[dockPanelView] || 'main.html';
  return todos.filter(f => { try { return String(f.url || '').includes(fichero); } catch { return false; } });
}
function sendStateToActiveDockFrame() {
  const fr = activeDockFrames();
  if (!fr.length) return;
  const s = getSerializableState();
  fr.forEach(f => { try { f.send('state', s); } catch {} });
}

// Todas las vistas del panel del dock (visibles o no).
function allDockFrames() {
  if (!dockPanelWin || dockPanelWin.isDestroyed()) return [];
  let todos = [];
  try { todos = dockPanelWin.webContents.mainFrame.frames || []; } catch { return []; }
  const ficheros = Object.values(DOCK_VIEW_FILE);
  return todos.filter(f => { try { return ficheros.some(x => String(f.url || '').includes(x)); } catch { return false; } });
}

let ticsDock = 0;
// opts.tic: es el refresco de cada segundo (solo cambian los tiempos), no un cambio de verdad.
function broadcastState(opts) {
  updateTrayTitle();
  // Se calcula una sola vez (antes, una por ventana, cada segundo).
  const s = getSerializableState();
  [widgetWin, mainWin, calendarWin, groupsWin].forEach(w => sendToAllFrames(w, 'state', s));
  // El panel del dock lo escucha su iframe (panel/calendario/tareas), no la página que lo
  // envuelve; la barrita (dockWin) no escucha 'state'. Con un cambio de verdad se ponen al
  // día TODAS sus vistas: así la que entra al cambiar de pestaña ya está pintada y no tiene
  // que rehacerse justo mientras se anima (eso era lo que se comía la animación). Con el
  // tic de cada segundo, solo la visible, y las escondidas cada cinco.
  const todas = !(opts && opts.tic) || (++ticsDock % 5 === 0);
  (todas ? allDockFrames() : activeDockFrames()).forEach(f => { try { f.send('state', s); } catch {} });
}

// ── Deshacer / rehacer (Ctrl+Z / Ctrl+Y) ─────────────────────────────────────────
// Antes de cada cambio en tareas, entradas o secciones se guarda una foto del estado. Los
// cambios seguidos del mismo tipo (p. ej. estirar un bloque varias veces) van en una sola.
const ACCIONES_DESHACIBLES = new Set([
  'start-task', 'add-subtask', 'add-subtask-and-start', 'rename-subtask', 'delete-subtask', 'pause',
  'switch-task', 'restart-task-with-note', 'resume-entry', 'create-task', 'update-task-meta',
  'set-task-memo', 'delete-task', 'restore-task', 'purge-task', 'edit-task-color', 'rename-task',
  'set-active-note', 'archive-task', 'unarchive-task', 'create-group', 'rename-group', 'delete-group',
  'move-task-to-group', 'set-group-palette', 'recolor-group-tasks', 'reorder-groups',
  'restore-and-start-task', 'edit-entry', 'delete-entry', 'add-calendar-entry', 'archive-purge',
]);
const pilaDeshacer = [], pilaRehacer = [];
let ultimaFoto = { type: null, t: 0 };
function fotoAntesDe(type) {
  const ahora = Date.now();
  if (type === ultimaFoto.type && ahora - ultimaFoto.t < 700) { ultimaFoto.t = ahora; return; }
  ultimaFoto = { type, t: ahora };
  pilaDeshacer.push(JSON.stringify(state));
  if (pilaDeshacer.length > 60) pilaDeshacer.shift();
  pilaRehacer.length = 0;
}
function deshacer(rehacer) {
  const de = rehacer ? pilaRehacer : pilaDeshacer, a = rehacer ? pilaDeshacer : pilaRehacer;
  if (!de.length) return false;
  a.push(JSON.stringify(state));
  state = JSON.parse(de.pop());
  ultimaFoto = { type: null, t: 0 };
  saveData(); broadcastState(); resetReminderTimer();
  return true;
}

ipcMain.on('action', (event, { type, payload }) => {
  if (ACCIONES_DESHACIBLES.has(type)) fotoAntesDe(type);
  switch (type) {
    case 'undo':
    case 'redo': {
      const ok = deshacer(type === 'redo');
      try { event.reply('undo-hecho', { tipo: type, ok }); } catch {}
      break;
    }
    case 'start-task':    startTask(payload.taskId, payload.backMinutes, payload.subId); break;
    case 'add-subtask':    addSubtask(payload.taskId, payload.name); break;
    // Crear y arrancar de una vez: quien la crea desde "Empezar tarea" la quiere ya en
    // marcha, y desde el renderer no se puede porque el id lo pone este proceso.
    case 'add-subtask-and-start': {
      addSubtask(payload.taskId, payload.name);
      const task = state.tasks.find(t => t.id === payload.taskId);
      const sub = task && (task.subtasks || [])[task.subtasks.length - 1];
      if (sub) startTask(task.id, payload.backMinutes, sub.id);
      break;
    }
    case 'rename-subtask': renameSubtask(payload.taskId, payload.subId, payload.name); break;
    case 'delete-subtask': deleteSubtask(payload.taskId, payload.subId); break;
    case 'pause':         pauseActive(); break;
    case 'switch-task':   switchTask(payload.taskId, payload.backMinutes, payload.subId, payload.note); break;
    case 'restart-task-with-note': restartActiveTaskWithNote(payload && payload.note); break;
    case 'resume-entry':  resumeEntry(payload.taskId, payload.entryIndex); break;
    case 'create-task': {
      const id = createTask(payload.name, payload.color, {
        taskType: payload.taskType,
        memo: payload.memo,
        erpId: payload.erpId,
        groupId: payload.groupId,   // solo para el color: de su paleta, si la sección tiene
      });
      // La sección es solo su etiqueta: se le pone y sigue sin archivar, así que nace
      // dentro de su sección en Tareas y a la vez a mano en el Panel.
      if (payload.groupId && state.groups.some(g => g.id === payload.groupId)) {
        const t = state.tasks.find(x => x.id === id);
        if (t) t.groupId = payload.groupId;
      }
      // Nota de esta sesión al crear+empezar (aparte del memo persistente).
      startTask(id, payload.backMinutes, payload.subId, payload.note);
      openMain();
      break;
    }
    case 'update-task-meta': {
      updateTaskMeta(payload.taskId, payload);
      break;
    }
    case 'set-task-memo': {
      setTaskMemo(payload.taskId, payload.memo);
      break;
    }
    case 'delete-task':   deleteTask(payload.taskId); break;
    case 'restore-task':  restoreTask(payload.taskId); break;
    case 'purge-task':    purgeTask(payload.taskId); break;
    case 'edit-task-color': editTaskColor(payload.taskId, payload.color); break;
    case 'rename-task':   renameTask(payload.taskId, payload.name); break;
    case 'set-active-note': setActiveEntryNote(payload.note); break;
    case 'archive-task':  archiveTask(payload.taskId, payload.groupId, payload.groupName); break;
    case 'unarchive-task': unarchiveTask(payload.taskId); break;
    case 'create-group':  createGroup(payload.name); break;
    case 'rename-group':  renameGroup(payload.groupId, payload.name); break;
    case 'delete-group':  deleteGroup(payload.groupId); break;
    case 'move-task-to-group': moveTaskToGroup(payload.taskId, payload.groupId); break;
    case 'set-group-palette': setGroupPalette(payload.groupId, payload.palette); break;
    case 'recolor-group-tasks': recolorGroupTasks(payload.groupId); break;
    case 'set-eye-care': {
      const p = payload || {};
      const antesActivo = !!settings.eyeCareEnabled;
      const antesCada = settings.eyeCareEvery;
      if (p.eyeCareEnabled !== undefined) settings.eyeCareEnabled = !!p.eyeCareEnabled;
      if (p.eyeCareEvery !== undefined) settings.eyeCareEvery = Math.max(1, Math.min(180, Number(p.eyeCareEvery) || 20));
      if (p.eyeCareRest !== undefined) settings.eyeCareRest = Math.max(5, Math.min(120, Number(p.eyeCareRest) || 20));
      if (p.eyeCarePos !== undefined) settings.eyeCarePos = p.eyeCarePos;
      if (p.eyeCareSize !== undefined) settings.eyeCareSize = Math.max(80, Math.min(420, Number(p.eyeCareSize) || 150));
      if (p.eyeCareSoloOjos !== undefined) settings.eyeCareSoloOjos = !!p.eyeCareSoloOjos;   // 2.8.3: sin fondo
      saveSettingsSoon(); broadcastState();
      // La cuenta atrás solo vuelve a empezar si se acaba de encender o si cambia cada
      // cuánto avisa. Mover el tamaño o la posición no debe retrasar el próximo aviso.
      const reiniciar = (!antesActivo && settings.eyeCareEnabled) || antesCada !== settings.eyeCareEvery;
      startEyeCareTimer(reiniciar);
      // Al tocar la posición o el tamaño se enseña un momento, para verlo mientras se ajusta.
      if (p.preview) showEyeCare(p.previewSeconds || 3, true);
      break;
    }
    case 'eye-done': hideEyeCare(); break;
    case 'set-leave': {
      const p = payload || {};
      settings.leaveEnabled = !!p.leaveEnabled;
      settings.leaveSameEveryDay = p.leaveSameEveryDay !== false;
      if (typeof p.leaveTime === 'string') settings.leaveTime = p.leaveTime;
      if (p.leaveDays && typeof p.leaveDays === 'object') settings.leaveDays = p.leaveDays;
      settings.leaveAutoStop = !!p.leaveAutoStop;
      leaveNotifiedOn = null;   // cambiar la hora vuelve a habilitar el aviso de hoy
      saveSettings(); broadcastState();
      startLeaveWatcher();
      break;
    }
    case 'set-impute-urls': {
      const lista = Array.isArray(payload && payload.urls) ? payload.urls : [];
      settings.imputeUrls = lista
        .map(u => normalizeUrl(String(u || '').trim().slice(0, 2000)))
        .filter(Boolean)
        .filter((u, i, a) => a.indexOf(u) === i);   // sin repetidos
      settings.imputeUrl = settings.imputeUrls[0] || '';   // el viejo ajuste, al día
      saveSettings(); broadcastState();
      break;
    }
    case 'open-impute-url': openImputeUrl(payload); break;
    case 'set-week-days': {
      const dias = Array.isArray(payload && payload.days)
        ? payload.days.map(Number).filter(d => d >= 0 && d <= 6) : [];
      settings.weekDays = dias.length ? [...new Set(dias)] : [1, 2, 3, 4, 5, 6, 0];
      saveSettings(); broadcastState();
      break;
    }
    case 'set-week-override': {
      const clave = String((payload && payload.week) || '');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(clave)) break;
      if (!settings.weekOverrides || typeof settings.weekOverrides !== 'object') settings.weekOverrides = {};
      if (payload.days === null) {
        delete settings.weekOverrides[clave];   // vuelve a lo de siempre
      } else {
        const dias = Array.isArray(payload.days) ? payload.days.map(Number).filter(d => d >= 0 && d <= 6) : [];
        settings.weekOverrides[clave] = [...new Set(dias)];
      }
      pruneWeekOverrides();
      saveSettings(); broadcastState();
      break;
    }
    case 'week-days-menu': showWeekDaysMenu(payload && payload.week); break;
    case 'set-group-sort':
      if (payload && payload.sort !== undefined) {
        settings.groupSort = ['alpha', 'created', 'custom'].includes(payload.sort) ? payload.sort : 'created';
      }
      if (payload && payload.dir !== undefined) {
        settings.groupSortDir = payload.dir === 'desc' ? 'desc' : 'asc';
      }
      saveSettings(); broadcastState();
      break;
    case 'reorder-groups': reorderGroups(payload && payload.ids); break;
    case 'restore-and-start-task': restoreAndStartTask(payload.taskId, payload.backMinutes, payload.subId, payload.note); break;
    case 'edit-entry':    editEntry(payload.taskId, payload.entryIndex, payload.startMs, payload.endMs, payload.note, payload.name, payload.subId); break;
    case 'delete-entry':  deleteEntry(payload.taskId, payload.entryIndex); break;
    case 'add-calendar-entry':
      addCalendarEntry(payload.taskId, payload.newTaskName, payload.newTaskColor, payload.startMs, payload.endMs, payload.note, payload.subId, payload.newTaskGroupId);
      break;
    case 'archive-purge': archivePurge(payload && payload.taskIds); break;
    case 'save-settings': {
      const wasDock = settings.dockMode;
      settings = { ...settings, ...payload };
      saveSettings(); resetReminderTimer(); applyLoginItem(); applyTranslucencyAll();
      applyDockMode(wasDock);   // crea/destruye el dock si ha cambiado el modo
      // El botón es "Aplicar": deja los ajustes aplicados pero SIN cerrarlos ni sacarte
      // de la pantalla, para poder seguir tocando cosas.
      break;
    }
    case 'set-blur':
      settings.blurEnabled = !!(payload && payload.enabled);
      saveSettings();
      // 2.8.3: el panel del dock ya no lleva material de Windows; el desenfoque es el de su
      // cristal, que llega con el tema (themeVars.difuminar) y se rehace solo.
      applyTranslucencyAll();
      break;
    // Aplicar un ajuste suelto al momento (los controles de Ajustes no deben esperar a
    // que se pulse "Aplicar" para verse).
    case 'set-setting': {
      const key = payload && payload.key;
      if (!key || !(key in settings)) break;
      settings[key] = payload.value;
      saveSettingsSoon();
      if (key === 'reminderMinutes' || key === 'widgetAutoHide' || key === 'widgetAutoHideSeconds') resetReminderTimer();
      if (key === 'openAtLogin') applyLoginItem();
      if (key === 'widgetScale') widgetBounds = null;   // el sitio guardado era del tamaño de antes
      broadcastState();   // p. ej. colorMode lo usan los selectores de color
      break;
    }
    case 'set-bg-opacity':
      settings.bgOpacity = Math.max(0, Math.min(100, Number(payload.value)));
      saveSettingsSoon(); applyTranslucencyAll();   // llega en cada 'input' del deslizador
      break;
    case 'mark-tutorial-seen': {
      const ids = Array.isArray(payload && payload.ids) ? payload.ids : [];
      const seen = new Set(settings.tutorialSeenSteps || []);
      const antes = seen.size;
      ids.forEach(id => seen.add(id));
      if (seen.size === antes) break;   // nada nuevo: ni guardar ni difundir
      settings.tutorialSeenSteps = [...seen];
      saveSettings(); broadcastState();
      break;
    }
    case 'reset-tutorial':
      settings.tutorialSeenSteps = [];
      saveSettings(); broadcastState();
      tourActive = true;   // el recorrido empieza por el Panel y de ahí va solo
      openMain();
      setTimeout(broadcastTourFlag, 400);
      break;
    // Una vista recién cargada pregunta si el usuario la está viendo ya. Hace falta
    // porque al cambiar de pestaña el iframe se recarga y se pierde el aviso 'dock-expanded'.
    case 'am-i-visible':
      if (dockExpanded) { try { event.reply('dock-expanded'); } catch {} }
      if (tourActive) { try { event.reply('tutorial-tour'); } catch {} }
      break;
    // Recorrido asistido: al acabar los pasos de una vista, lleva solo a la siguiente.
    // Las vistas que ya no tengan nada pendiente lo mandan también, para no dejar al
    // usuario plantado en una pantalla sin explicación ninguna.
    case 'tutorial-next': {
      if (!tourActive) break;   // no hay recorrido en marcha: nadie tiene que ir a ningún lado
      const idx = TOUR_ORDER.indexOf(payload && payload.from);
      const next = idx >= 0 ? TOUR_ORDER[idx + 1] : null;
      if (!next) { tourActive = false; break; }
      const open = { calendar: openCalendar, groups: openGroups, settings: openSettings };
      setTimeout(() => { try { open[next](); } catch {} }, 260);
      break;
    }
    case 'tutorial-stop': tourActive = false; break;
    case 'open-main':     openMain(); break;
    case 'open-calendar': openCalendar(); break;
    case 'open-settings': openSettings(); break;
    case 'open-groups':   openGroups(); break;
    case 'close-widget':  hideWidget(); break;
    case 'widget-escala-vivo': {   // Ajustes: el deslizador de tamaño, mientras se mueve
      settings.widgetScale = Math.max(80, Math.min(150, Number(payload && payload.value) || 100));
      saveSettingsSoon();
      if (widgetWin && !widgetWin.isDestroyed()) {
        try { widgetWin.webContents.send('widget-escala', widgetEscala()); } catch {}
        scheduleWidgetAutoHide();   // que no se esconda mientras lo ajustas
      } else createWidgetWindow();
      break;
    }
    case 'preview-widget':   // Ajustes: enseñar el recordatorio con el tamaño elegido
      if (widgetWin && !widgetWin.isDestroyed()) { try { widgetWin.destroy(); } catch {} widgetWin = null; }
      createWidgetWindow();
      break;
    case 'widget-raton': {   // la tarjeta pide los clics solo mientras el ratón está encima
      const win = BrowserWindow.fromWebContents(event.sender);
      if (win && !win.isDestroyed()) try { win.setIgnoreMouseEvents(!payload.dentro, { forward: true }); } catch {}
      break;
    }
    case 'close-main':
      if (settings.dockMode && dockWin && !dockWin.isDestroyed()) dockWin.webContents.send('dock-collapse');
      else if (mainWin && !mainWin.isDestroyed()) mainWin.hide();
      break;
    case 'dock-hit-rects':
      dockHitRects = (payload && Array.isArray(payload.rects)) ? payload.rects : [];
      dockBarRect = (payload && payload.barRect) || null;
      updateDockHitTest();
      break;
    case 'set-dnd': setDnd(payload && payload.minutes === null ? null : Number(payload && payload.minutes) || 0); break;
    case 'calendar-context-menu': showCalendarContextMenu(payload && payload.taskId, payload && payload.entryIndex); break;
    case 'dock-context-menu': showDockContextMenu(); break;
    case 'show-dock-bar': hideDockFor(null); break;
    case 'dock-expand':            // la barrita pide abrir el panel
      showDockPanel();
      break;
    case 'dock-collapse-panel':     // la barrita (o su botón) pide cerrarlo
      collapseDockPanel();
      break;
    case 'dock-view-changed':
      if (payload && payload.view) {
        dockPanelView = payload.view;
        rememberView(payload.view);
        // 2.8: las vistas ya no se recargan (cada una vive en su iframe) y están al día (ver
        // broadcastState). Los tiempos se refrescan cuando ha terminado de entrar: mandárselos
        // antes la hacía repintarse en mitad de la animación.
        setTimeout(sendStateToActiveDockFrame, 700);
        // 2.8.3: el ancho lo anima la página y avisa con 'dock-panel-rect'.
      }
      break;
    // 2.8.3: la forma visible de la ventana que lo pide (lo de fuera deja pasar los clics y no
    // lleva desenfoque). x, y, w, h en px de la página; radios de las esquinas.
    case 'forma-ventana': {
      const win = BrowserWindow.fromWebContents(event.sender);
      if (!win || win.isDestroyed() || !payload) break;
      const clave = [payload.x, payload.y, payload.w, payload.h, (payload.radios || []).join(',')].map(v => typeof v === 'number' ? Math.round(v) : v).join('|');
      if (win.__forma === clave) break;   // sin cambios: ni se toca (cada setShape repinta)
      win.__forma = clave;
      try { win.setShape(formaRedondeada(payload.x, payload.y, payload.w, payload.h, payload.radios)); } catch {}
      break;
    }
    // Desenfoque del propio Windows detrás de la ventana (cero retraso: lo pinta el compositor).
    case 'desenfoque-sistema': {
      // DESACTIVADO: Windows desenfoca el rectángulo ENTERO de la ventana, sin respetar su forma
      // (probado con setShape y con SetWindowRgn nativo): con el panel, que ocupa la pantalla,
      // desenfocaba todo. Solo valdría con ventanas del tamaño exacto de la tarjeta.
      if (!USAR_DESENFOQUE_SISTEMA) break;
      const win = BrowserWindow.fromWebContents(event.sender);
      if (!win || win.isDestroyed()) break;
      const on = !!(payload && payload.on);
      if (win.__desenfoque === on) break;
      win.__desenfoque = on;
      if (on) aplicarDesenfoqueWindows(win, { estado: 3 }); else quitarDesenfoqueWindows(win);
      break;
    }
    case 'dock-panel-rect': {   // dónde está la tarjeta: botón = su tamaño; forma = cuánto dejar visible
      if (!dockPanelWin || dockPanelWin.isDestroyed() || !payload) break;
      const boton = Number(payload.boton) || 0, forma = payload.forma == null ? boton : Number(payload.forma) || 0;
      if (forma > 0) aplicarFormaPanel(forma);
      if (boton > 0) {
        dockPanelRect = rectPanel(boton);
        if (dockExpanded && !dockPanelWin.__botonPendiente) positionDockHide(dockPanelRect);
      }
      break;
    }
    case 'dock-panel-entrando':   // la tarjeta empieza a deslizarse: ahora sí, el botón
      if (dockPanelWin && !dockPanelWin.isDestroyed() && dockPanelWin.__botonPendiente) dockPanelWin.__botonPendiente();
      break;
    case 'dock-panel-salido':     // el panel ya ha salido deslizándose: se esconde la ventana
      if (dockPanelWin && !dockPanelWin.isDestroyed() && dockPanelWin.__alSalir) dockPanelWin.__alSalir();
      break;
    case 'dock-panel-resize-end': {
      // Se recuerda por separado: el ancho del calendario no pisa el del resto.
      const c = dockConfig();
      const vertical = c.anchor === 'left' || c.anchor === 'right';
      const size = Math.round(Number(payload && payload.size) || 0);
      if (size > 0) {
        const lim = (a, b) => Math.max(a, Math.min(b, size));
        if (!vertical) settings.dockPanelHeight = lim(260, 1400);
        else if ((payload && payload.view) === 'calendar') settings.dockCalendarWidth = lim(420, 1900);
        else settings.dockPanelWidth = lim(320, 1600);
        saveSettingsSoon();
        sendDockConfig();   // la barrita necesita el tamaño para colocar su botón
      }
      break;
    }
    // El módulo screen no está disponible de forma fiable dentro de un iframe del dock:
    // la lista de monitores se pide aquí (por eso el desplegable salía vacío).
    case 'get-displays':
      event.reply('displays', screen.getAllDisplays().map((d, i) => ({
        id: d.id, index: i + 1,
        width: d.size.width, height: d.size.height,
        primary: d.bounds.x === 0 && d.bounds.y === 0,
      })));
      break;
    case 'dock-focus':
      checkForUpdatesIfStale();
      if (dockWin && !dockWin.isDestroyed()) { try { dockWin.focus(); } catch {} }
      break;
    // Vista previa en vivo mientras se toquetea la barra en Ajustes (sin darle a Guardar).
    case 'set-dock-config': {
      const { preview, ...vals } = payload || {};
      settings = { ...settings, ...vals };
      if (vals.dockDisplayId !== undefined) {
        const elegida = screen.getAllDisplays().find(d => d.id === vals.dockDisplayId);
        settings.dockDisplayKey = elegida ? displayKey(elegida) : null;
      }
      saveSettingsSoon();   // los deslizadores disparan esto muchas veces por segundo
      if (settings.dockMode) { createDock(); positionDock(); }
      // Con el panel abierto la barrita se oculta; al ajustarla hay que verla.
      if (preview && dockWin && !dockWin.isDestroyed()) {
        const now = Date.now();
        if (now - lastBarRaiseAt > 1500) {
          lastBarRaiseAt = now;
          try { dockWin.moveTop(); } catch {}   // si no, queda debajo de la ventana del panel
        }
        try { dockWin.webContents.send('dock-bar-preview'); } catch {}
      }
      break;
    }
    // El interruptor de "modo barra flotante" se aplica al momento (no al Guardar), y
    // deja el dock en Ajustes para poder seguir configurándolo sin perder de vista nada.
    case 'set-dock-mode': {
      const wasDock = !!settings.dockMode;
      settings.dockMode = !!(payload && payload.enabled);
      saveSettings();
      if (settings.dockMode) {
        [mainWin, calendarWin, groupsWin, settingsWin].forEach(w => { try { if (w && !w.isDestroyed()) w.hide(); } catch {} });
        createDock();
        if (!wasDock) dockNavigate('settings'); else positionDock();
      } else if (wasDock) {
        destroyDock();
        openSettings();
      }
      updateTrayTitle();
      break;
    }
    case 'get-theme':     event.reply('theme', themeVars()); break;
    case 'get-whats-new': {
      const v = app.getVersion();
      const notes = WHATS_NEW[v];
      event.reply('whats-new', { version: v, title: notes && notes.title, steps: (notes && notes.steps) || [] });
      break;
    }
    case 'show-whats-new': openWhatsNew(); break;   // botón "Ver novedades" de Ajustes
    // Del resumen de novedades al recorrido guiado: los pasos del tutorial llevan la
    // versión en la que se añadieron, así que los pendientes son justo los de lo nuevo.
    case 'start-whats-new-tour':
      if (whatsNewWin && !whatsNewWin.isDestroyed()) whatsNewWin.close();
      tourActive = true;
      openMain();
      setTimeout(broadcastTourFlag, 400);   // por si el Panel ya era la vista abierta
      break;
    case 'close-whats-new':
      if (whatsNewWin && !whatsNewWin.isDestroyed()) whatsNewWin.close();
      break;
    case 'set-theme':
      if (payload && payload.theme !== undefined) {
        settings.theme = THEMES[payload.theme] ? payload.theme : DEFAULT_THEME;
        applySystemThemeSource();
      }
      if (payload && payload.accent !== undefined) {
        settings.accent = ACCENTS[payload.accent] ? payload.accent : null;   // null = el del tema
      }
      saveSettings(); broadcastTheme();
      break;
    case 'get-settings':  event.reply('settings', settings); break;
    case 'min-main':      if (mainWin && !mainWin.isDestroyed()) mainWin.minimize(); break;
    case 'close-calendar':
      if (settings.dockMode) dockNavigate('panel');
      else { if (calendarWin && !calendarWin.isDestroyed()) calendarWin.hide(); ensureSomeWindowVisible(); }
      break;
    case 'close-settings':
      if (settings.dockMode) dockNavigate('panel');
      else if (settingsWin && !settingsWin.isDestroyed()) settingsWin.hide();
      break;
    case 'close-groups':
      if (settings.dockMode) dockNavigate('panel');
      else { if (groupsWin && !groupsWin.isDestroyed()) groupsWin.hide(); ensureSomeWindowVisible(); }
      break;
    case 'open-sync':     openSync(); break;
    case 'close-sync':    if (syncWin && !syncWin.isDestroyed()) syncWin.close(); break;   // se recrea al abrirla (openSync)
    case 'open-update-window': openUpdateWindow(); break;   // desde el botón rojo del panel
    case 'update-download': if (autoUpdater) autoUpdater.downloadUpdate(); break;
    case 'update-install':  installUpdateNow(); break;
    case 'close-update':    if (updateWin && !updateWin.isDestroyed()) updateWin.close(); break;
    case 'check-for-updates': checkForUpdates(true); break;   // botón "Buscar actualizaciones" de Ajustes
    case 'set-beta-updates':
      settings.betaUpdates = !!(payload && payload.enabled);
      saveSettings();
      if (autoUpdater) {
        autoUpdater.allowPrerelease = settings.betaUpdates;
        lastAutoCheckAt = 0;              // que la próxima comprobación no la frene el límite
        checkForUpdates(true);            // mirar ya en el canal nuevo
      }
      break;
    case 'get-state':     event.reply('state', getSerializableState()); break;
  }
});

// Arrastre de ventana desde el asa (.win-drag). Lo hacemos a mano porque
// -webkit-app-region: drag no funcionaba en la ventana del calendario. Guardamos la
// posición del cursor y de la ventana al empezar, y en cada movimiento reposicionamos
// según cuánto se ha desplazado el cursor.
let winDragState = null;
ipcMain.on('win-drag', (event, phase) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win || win.isDestroyed()) return;
  if (phase === 'start') {
    winDragState = { win, cursor: screen.getCursorScreenPoint(), bounds: win.getBounds() };
  } else if (phase === 'move' && winDragState && winDragState.win === win) {
    const p = screen.getCursorScreenPoint();
    const { cursor, bounds } = winDragState;
    const x = bounds.x + (p.x - cursor.x);
    const y = bounds.y + (p.y - cursor.y);
    // Solo tocamos el ancho/alto cuando de verdad se ha desviado del original (al cruzar
    // a una pantalla con distinta escala/DPI, Windows reescala la ventana sola). Antes se
    // reafirmaba el tamaño en CADA movimiento incluso sin hacer falta, y ese setBounds de
    // más (compitiendo con el reescalado del sistema) es lo que se veía como pequeños
    // saltos/tirones mientras se arrastraba. Así solo se corrige cuando hay algo que corregir.
    const current = win.getBounds();
    if (current.width !== bounds.width || current.height !== bounds.height) {
      win.setBounds({ x, y, width: bounds.width, height: bounds.height });
    } else {
      win.setPosition(x, y);
    }
  } else if (phase === 'end') {
    winDragState = null;
  }
});

// Exportar CSV: abre un diálogo nativo "Guardar como…" y escribe el archivo.
// El contenido lo genera el renderer (que ya tiene el estado y sabe qué rango exportar).
ipcMain.handle('export-csv', async (_e, { content, defaultName }) => {
  try {
    const parent = calendarWin && !calendarWin.isDestroyed() ? calendarWin : undefined;
    const baseDir = app.getPath('documents') || app.getPath('home') || app.getPath('desktop') || '';
    const { canceled, filePath } = await dialog.showSaveDialog(parent, {
      title: 'Exportar horas',
      defaultPath: path.join(baseDir, defaultName || 'imputa-horas.csv'),
      filters: [{ name: 'CSV', extensions: ['csv'] }],
    });
    if (canceled || !filePath) return { ok: false, canceled: true };
    fs.writeFileSync(filePath, '﻿' + (content || ''), 'utf8');  // BOM para que Excel respete los acentos
    return { ok: true, path: filePath };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
});

// ── Copia de seguridad (export/import de tareas y grupos a un .json local) ────
function deepEqual(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

ipcMain.handle('export-backup', async () => {
  try {
    const parent = settingsWin && !settingsWin.isDestroyed() ? settingsWin : (mainWin || undefined);
    const baseDir = app.getPath('documents') || app.getPath('home') || app.getPath('desktop') || '';
    const { canceled, filePath } = await dialog.showSaveDialog(parent, {
      title: 'Exportar copia de seguridad',
      defaultPath: path.join(baseDir, `imputa-backup-${new Date().toISOString().slice(0, 10)}.json`),
      filters: [{ name: 'Copia de seguridad de imputa.me', extensions: ['json'] }],
    });
    if (canceled || !filePath) return { ok: false, canceled: true };
    const payload = { imputaBackup: true, exportedAt: new Date().toISOString(), tasks: state.tasks, groups: state.groups };
    fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf8');
    return { ok: true, path: filePath };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
});

// Guarda el backup ya leído entre 'import-backup' (que solo calcula qué hay que
// decidir) y 'apply-import-backup' (que lo aplica), para no tener que mandar todo
// el JSON de un lado a otro dos veces por IPC.
let pendingImport = null;

ipcMain.handle('import-backup', async () => {
  try {
    const parent = settingsWin && !settingsWin.isDestroyed() ? settingsWin : (mainWin || undefined);
    const { canceled, filePaths } = await dialog.showOpenDialog(parent, {
      title: 'Restaurar copia de seguridad',
      filters: [{ name: 'Copia de seguridad de imputa.me', extensions: ['json'] }],
      properties: ['openFile'],
    });
    if (canceled || !filePaths || !filePaths[0]) return { ok: false, canceled: true };
    const raw = JSON.parse(fs.readFileSync(filePaths[0], 'utf8'));
    if (!raw || !Array.isArray(raw.tasks) || !Array.isArray(raw.groups)) {
      return { ok: false, error: 'El archivo no es una copia de seguridad válida de imputa.me.' };
    }
    // Compara cada tarea/grupo de la copia con lo que ya hay en local por id: si no
    // existe es nuevo (se añade sin preguntar), si es idéntico se ignora en silencio,
    // y si existe pero con datos distintos es un conflicto que hay que decidir.
    const conflicts = [];
    let newCount = 0, sameCount = 0;
    const localTasksById = new Map(state.tasks.map(t => [t.id, t]));
    const localGroupsById = new Map(state.groups.map(g => [g.id, g]));
    raw.tasks.forEach(t => {
      const local = localTasksById.get(t.id);
      if (!local) newCount++;
      else if (deepEqual(local, t)) sameCount++;
      else conflicts.push({ kind: 'task', id: t.id, key: `task:${t.id}`, name: t.name, localName: local.name });
    });
    raw.groups.forEach(g => {
      const local = localGroupsById.get(g.id);
      if (!local) newCount++;
      else if (deepEqual(local, g)) sameCount++;
      else conflicts.push({ kind: 'group', id: g.id, key: `group:${g.id}`, name: g.name, localName: local.name });
    });
    pendingImport = raw;
    return { ok: true, newCount, sameCount, conflicts };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
});

ipcMain.handle('apply-import-backup', async (_e, payload) => {
  if (!pendingImport) return { ok: false, error: 'No hay ninguna copia cargada.' };
  const raw = pendingImport; pendingImport = null;
  const res = (payload && payload.resolutions) || {};
  pauseActive();   // evita que un reemplazo deje la tarea activa en un estado ambiguo
  raw.groups.forEach(g => {
    const idx = state.groups.findIndex(x => x.id === g.id);
    if (idx === -1) { state.groups.push(g); return; }
    if (deepEqual(state.groups[idx], g)) return;
    if (res[`group:${g.id}`] === 'replace') state.groups[idx] = g;
  });
  raw.tasks.forEach(t => {
    const idx = state.tasks.findIndex(x => x.id === t.id);
    if (idx === -1) { state.tasks.push(t); return; }
    if (deepEqual(state.tasks[idx], t)) return;
    if (res[`task:${t.id}`] === 'replace') state.tasks[idx] = t;
  });
  saveData(); broadcastState();
  return { ok: true };
});

// Foto de lo que hay DETRÁS del panel del dock (el escritorio y las demás apps), para su
// cristal líquido cuando la translucidez no está en mate. Cubre la zona más ancha que
// puede ocupar el panel (la del calendario), así sirve aunque cambie de ancho. Mientras se
// hace, el panel y la barrita se excluyen de las capturas (setContentProtection →
// WDA_EXCLUDEFROMCAPTURE) para no salir en su propia foto, y enseguida se dejan como
// estaban, para que sí salgan si compartes pantalla.
// La pantalla en directo para el cristal del recordatorio y de los ojos: el id de la pantalla
// donde está la ventana que lo pide, que se excluye de la captura para no verse a sí misma.
// Para la captura nativa del cristal (src/captura-dxgi.js, en la página): la pantalla donde
// está la ventana, en px lógicos (dip) y físicos (fis), para pasar de unos a otros. La ventana
// deja de salir en capturas (WDA_EXCLUDEFROMCAPTURE): si no, el cristal se vería a sí mismo.
// Ventanas excluidas de capturas por su cristal en vivo. Cuando el usuario va a hacer una captura
// (capturas-windows.js) se les quita la exclusión un momento, con el cristal congelado.
const ventanasExcluidas = new Set();
let capturaEnCurso = false;
function cristalesPausados(on) {
  ventanasExcluidas.forEach(w => { if (w.isDestroyed()) ventanasExcluidas.delete(w); else sendToAllFrames(w, 'captura-pausa', on); });
}
function exclusionCapturas(on) {
  ventanasExcluidas.forEach(w => { if (w.isDestroyed()) ventanasExcluidas.delete(w); else { try { w.setContentProtection(on); } catch {} } });
}
function alCambiarCaptura(empieza) {
  capturaEnCurso = empieza;
  if (empieza) {
    // Primero se congela el cristal (si no, vería la propia ventana) y luego se deja ver.
    cristalesPausados(true);
    setTimeout(() => { if (capturaEnCurso) exclusionCapturas(false); }, 60);
  } else {
    exclusionCapturas(true);
    setTimeout(() => { if (!capturaEnCurso) cristalesPausados(false); }, 90);
  }
}

ipcMain.handle('fuente-dxgi', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win || win.isDestroyed()) return null;
  ventanasExcluidas.add(win);
  if (capturaEnCurso) sendToAllFrames(win, 'captura-pausa', true);
  else { try { win.setContentProtection(true); } catch {} }
  try {
    const d = screen.getDisplayMatching(win.getBounds());
    let fis;
    try { fis = screen.dipToScreenRect(null, d.bounds); } catch { fis = null; }
    if (!fis) fis = { x: Math.round(d.bounds.x * d.scaleFactor), y: Math.round(d.bounds.y * d.scaleFactor), width: Math.round(d.bounds.width * d.scaleFactor), height: Math.round(d.bounds.height * d.scaleFactor) };
    return { dip: d.bounds, fis, sf: fis.width / d.bounds.width };
  } catch { return null; }
});

ipcMain.handle('fuente-pantalla', async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win || win.isDestroyed()) return null;
  try { win.setContentProtection(true); } catch {}
  try {
    const disp = screen.getDisplayMatching(win.getBounds());
    const fuentes = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } });
    const src = fuentes.find(s => String(s.display_id) === String(disp.id)) || fuentes[0];
    const b = disp.bounds;
    return src ? { id: src.id, region: { x: b.x, y: b.y, w: b.width, h: b.height } } : null;
  } catch { return null; }
});

ipcMain.handle('capture-desktop', async (event, opts) => {
  // { propia: true }: lo que hay detrás de la ventana que lo pide (el recordatorio). Si no,
  // lo de detrás del panel del dock y su calendario.
  const propia = opts && opts.propia ? BrowserWindow.fromWebContents(event.sender) : null;
  const protegidas = (propia ? [propia] : [dockPanelWin, dockWin]).filter(w => w && !w.isDestroyed());
  try {
    let disp, region;
    if (propia) {
      const b = propia.getBounds();
      disp = screen.getDisplayMatching(b);
      region = { x: b.x, y: b.y, w: b.width, h: b.height };
    } else {
      disp = dockDisplay();
      const a = computePanelBounds('panel'), b = computePanelBounds('calendar');
      const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
      region = { x, y, w: Math.max(a.x + a.width, b.x + b.width) - x, h: Math.max(a.y + a.height, b.y + b.height) - y };
    }
    const sf = disp.scaleFactor || 1;
    protegidas.forEach(w => { try { w.setContentProtection(true); } catch {} });
    await new Promise(r => setTimeout(r, 40));   // que el sistema lo aplique antes de la foto
    const fuentes = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: Math.round(disp.bounds.width * sf), height: Math.round(disp.bounds.height * sf) },
    });
    const src = fuentes.find(s => String(s.display_id) === String(disp.id)) || fuentes[0];
    if (!src || !src.thumbnail || src.thumbnail.isEmpty()) return null;
    const k = src.thumbnail.getSize().width / disp.bounds.width;
    const img = src.thumbnail.crop({
      x: Math.round((region.x - disp.bounds.x) * k), y: Math.round((region.y - disp.bounds.y) * k),
      width: Math.round(region.w * k), height: Math.round(region.h * k),
    });
    const data = img.toBitmap();
    let { width: pw, height: ph } = img.getSize();
    if (data.length !== pw * ph * 4) {
      const s = Math.sqrt(data.length / 4 / (pw * ph));
      pw = Math.round(pw * s); ph = Math.round(ph * s);
      if (data.length !== pw * ph * 4) return null;
    }
    return { data, pw, ph, region };
  } catch { return null; }
  // Las que llevan cristal en vivo siguen excluidas (si no, se verían a sí mismas).
  finally { protegidas.forEach(w => { if (!ventanasExcluidas.has(w) || capturaEnCurso) { try { w.setContentProtection(false); } catch {} } }); }
});

// Login/logout de sincronización (respuestas asíncronas)
ipcMain.handle('sync-login', async (_e, { email, password }) => sync ? sync.login(email, password) : { ok: false, error: 'Sync no disponible' });
ipcMain.handle('sync-logout', async () => sync ? sync.logout() : { ok: true });
ipcMain.handle('sync-status', async () => syncStatus);

// 2.8: foto de la ventana para el cristal líquido de los bocadillos (src/glass.js). Va en
// crudo (BGRA, sin comprimir: es lo más rápido) junto con el ancho de la página en px CSS,
// para saber la escala, y, si quien la pide va dentro del panel del dock (en un iframe),
// dónde cae ese iframe dentro de la ventana.
ipcMain.handle('capture-region', async (event) => {
  try {
    const wc = event.sender;
    if (!wc || wc.isDestroyed()) return null;
    const frame = event.senderFrame;
    let vista = null;
    if (frame && frame.parent) {
      vista = Object.keys(DOCK_VIEW_FILE).find(v => (frame.url || '').includes(DOCK_VIEW_FILE[v]));
      if (!vista) return null;
    }
    const sitio = await wc.executeJavaScript(`(() => {
      const f = ${vista ? `document.querySelector('iframe[data-view="${vista}"]')` : 'null'};
      const r = f ? f.getBoundingClientRect() : { left: 0, top: 0 };
      return { iw: window.innerWidth, ih: window.innerHeight, x: r.left, y: r.top };
    })()`);
    if (!sitio || !sitio.iw) return null;
    const img = await wc.capturePage();
    if (!img || img.isEmpty()) return null;
    const data = img.toBitmap();
    let { width: pw, height: ph } = img.getSize();
    if (data.length !== pw * ph * 4) {
      // Según la versión, getSize() va en px lógicos y el mapa de bits en px reales.
      const s = Math.sqrt(data.length / 4 / (pw * ph));
      pw = Math.round(pw * s); ph = Math.round(ph * s);
      if (data.length !== pw * ph * 4) return null;
    }
    return { data, pw, ph, iw: sitio.iw, ih: sitio.ih, offX: sitio.x, offY: sitio.y };
  } catch { return null; }
});

function startTick() {
  tickTimer = setInterval(() => {
    // broadcastState ya actualiza la bandeja: llamarla también aquí era hacerlo doble.
    if (state.activeTaskId) broadcastState({ tic: true });
    else updateTrayTitle();
  }, 1000);
}

// ── Auto-actualización (electron-updater + GitHub Releases) ───────────────────
// Comprueba al arrancar si hay una versión más nueva publicada en GitHub Releases.
// Si la hay, avisa con un diálogo nativo y, con un botón, la descarga e instala.
// No necesita ninguna ventana de la app (funciona aunque el panel esté cerrado).
let autoUpdater = null;
let manualCheck = false;   // true cuando el usuario pulsa "Buscar actualizaciones…"
let lastAutoCheckAt = 0;
const AUTO_CHECK_THROTTLE_MS = 60 * 1000;   // como mucho una comprobación automática cada minuto

// Comprueba actualizaciones si ha pasado un rato desde la última vez (se llama al
// volver al panel): así, si estaba abierta de fondo cuando salió una versión nueva,
// no hay que esperar al temporizador de 1h ni acordarse de pulsar "Buscar
// actualizaciones" a mano — basta con volver a la app.
function checkForUpdatesIfStale() {
  if (!autoUpdater) return;
  if (Date.now() - lastAutoCheckAt < AUTO_CHECK_THROTTLE_MS) return;
  checkForUpdates(false);
}

function setupAutoUpdate() {
  if (!app.isPackaged) return;          // en desarrollo no existe app-update.yml
  try {
    ({ autoUpdater } = require('electron-updater'));
  } catch {
    autoUpdater = null;                 // dependencia no instalada aún
    return;
  }
  // Nada se descarga ni se instala sin permiso: al detectar una versión nueva solo se
  // avisa, y el usuario decide si descargarla ("Descargar ahora") o dejarlo para luego.
  autoUpdater.autoDownload = false;
  // Si ya se descargó y la app se cierra por su cuenta, se aprovecha para instalarla
  // (no interrumpe nada, porque el usuario ya estaba saliendo).
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowPrerelease = !!settings.betaUpdates;   // canal betatester

  autoUpdater.on('update-available', (info) => {
    manualCheck = false;
    const isNew = !updateInfo || updateInfo.version !== info.version;
    updateInfo = { version: info.version };
    broadcastState();                    // muestra el botón rojo "Actualizar" en el panel
    openUpdateWindow();
    sendUpdateState({ phase: 'available', current: app.getVersion(), version: info.version });
    // Notificación del sistema, para enterarse aunque se esté en otra aplicación. Solo la
    // primera vez que se detecta esa versión, para no repetirla en cada comprobación.
    if (isNew) notifyUpdateAvailable(info.version);
  });

  autoUpdater.on('download-progress', (p) => {
    sendUpdateState({ phase: 'downloading', percent: Math.max(0, Math.min(100, Math.round(p.percent || 0))) });
  });

  autoUpdater.on('update-not-available', () => {
    if (manualCheck) { openUpdateWindow(); sendUpdateState({ phase: 'uptodate', current: app.getVersion() }); }
    manualCheck = false;
  });

  autoUpdater.on('update-downloaded', (info) => {
    // Descargada, pero NO se instala sola: se avisa y el usuario elige cuándo reiniciar.
    openUpdateWindow();
    sendUpdateState({ phase: 'downloaded', version: info.version });
  });

  autoUpdater.on('error', (err) => {
    if (manualCheck) { openUpdateWindow(); sendUpdateState({ phase: 'error', message: String((err && err.message) || err) }); }
    manualCheck = false;
  });

  checkForUpdates(false);                              // al arrancar
  setTimeout(() => checkForUpdates(false), 15000);     // reintento por si la red aún no estaba lista (p.ej. arranque con Windows)
  setInterval(() => checkForUpdates(false), 5 * 60 * 1000);   // y cada 5 min mientras esté abierta
}

function notifyUpdateAvailable(version) {
  if (dndActive()) return;   // el botón del panel sigue estando; el aviso encima, no
  try {
    if (!Notification.isSupported()) return;
    const n = new Notification({
      title: 'imputa.me · actualización disponible',
      body: `Versión ${version} lista para descargar. Tú decides cuándo.`,
      icon: APP_ICON_PATH,
      silent: false,
    });
    n.on('click', () => { openUpdateWindow(); });
    n.show();
  } catch {}
}

function checkForUpdates(manual) {
  if (!autoUpdater) {
    if (manual) { openUpdateWindow(); sendUpdateState({ phase: 'unavailable' }); }
    return;
  }
  lastAutoCheckAt = Date.now();
  manualCheck = manual;
  if (manual) { openUpdateWindow(); sendUpdateState({ phase: 'checking' }); }
  autoUpdater.checkForUpdates().catch((err) => {
    if (manualCheck) { openUpdateWindow(); sendUpdateState({ phase: 'error', message: String((err && err.message) || err) }); }
    manualCheck = false;
  });
}

// ── App lifecycle ─────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  vigilarCapturas(alCambiarCaptura);   // que la app salga en las capturas del usuario (ver fuente-dxgi)
  DATA_FILE = path.join(app.getPath('userData'), 'imputa-tasks.json');
  SETTINGS_FILE = path.join(app.getPath('userData'), 'imputa-settings.json');
  loadData();
  pruneWeekOverrides();
  applySystemThemeSource();
  // Instalación nueva: el recorrido va solo por las cuatro pantallas. En cualquier otro
  // caso hay que pedirlo desde Ajustes; si no, a quien le quedaran pasos sueltos se lo
  // encontraría paseándole por la app en cada arranque.
  if (!(settings.tutorialSeenSteps || []).length) tourActive = true;
  startLeaveWatcher();
  startEyeCareTimer();
  // No molestar se apaga solo al vencer: dndActive() lo caduca y avisa a las vistas.
  setInterval(() => { if (settings.dndUntil) dndActive(); }, 30000);

  // Sincronización opcional (Supabase). Si hay sesión guardada, arranca sola.
  if (sync) sync.init({
    sessionFile: path.join(app.getPath('userData'), 'imputa-sync.json'),
    getState: () => state,
    saveRaw: saveDataRaw,
    onChange: () => { saveDataRaw(); broadcastState(); },
    onStatus: (s) => {
      syncStatus = s;   // el menú de la bandeja lo lee al abrirse
      if (syncWin && !syncWin.isDestroyed()) syncWin.webContents.send('sync-status', s);
      // Ajustes puede estar como ventana o embebido en el panel del dock (iframe): a los
      // dos. Se mandaba a dockWin, la barrita, que no tiene Ajustes dentro.
      sendToAllFrames(settingsWin, 'sync-status', s);
      sendToAllFrames(dockPanelWin, 'sync-status', s);
    },
  }).catch(() => {});

  const trayIcon = nativeImage.createFromPath(APP_ICON_PATH).resize({ width: 32, height: 32, quality: 'best' });

  tray = new Tray(trayIcon);
  tray.setToolTip('imputa.me');
  // El menú se monta al abrirlo, no cada segundo (ver updateTrayTitle).
  tray.on('right-click', () => { try { tray.popUpContextMenu(buildTrayMenu()); } catch {} });
  tray.on('click', () => openLastView());

  // Conectar/desconectar monitores o cambiar su resolución deja las medidas viejas.
  ['display-added', 'display-removed', 'display-metrics-changed'].forEach(ev => {
    try {
      screen.on(ev, () => {
        // Varias pasadas: al desconectar un monitor, Windows tarda un poco en dejar
        // las áreas de trabajo definitivas, y una sola pasada inmediata las coge a medias.
        [0, 400, 1500, 4000].forEach(ms => setTimeout(() => {
          if (!settings.dockMode) return;
          positionDock(); syncDockBounds(); ensureDockBarVisible();
        }, ms));
      });
    } catch {}
  });
  setInterval(() => {
    if (!settings.dockMode) return;
    // dockIsHidden() caduca el escondite solo, y ensureDockBarVisible la devuelve
    // (y le reafirma el nivel, por si algo a pantalla completa se puso delante).
    if (dockIsHidden()) return;
    ensureDockBarVisible();   // ya hace syncDockBounds
  }, 3000);

  startTick();
  resetReminderTimer();
  applyLoginItem();                         // sincroniza el registro con el ajuste guardado
  // Si arranca solo por el inicio de sesión de Windows (--hidden), no se abre el panel.
  // PERO en modo barra flotante la barrita ES la presencia de la app (ya es discreta de
  // por sí), así que hay que crearla igualmente: si no, arrancar con Windows dejaba la
  // app sin nada visible salvo el icono de la bandeja.
  if (process.argv.includes('--hidden')) {
    if (settings.dockMode) {
      createDock();
      // Arrancando con Windows, las pantallas todavía no son las definitivas: se recoloca
      // un par de veces después para que la barrita no quede fuera ni en medio.
      setTimeout(ensureDockBarVisible, 2500);
      setTimeout(ensureDockBarVisible, 8000);
    }
  } else {
    showSplashThenMain();
  }
  setupAutoUpdate();
  maybeShowWhatsNew();
});

// Cierre a conciencia antes de instalar una actualización.
// El instalador intenta cerrar la app por su cuenta y no siempre puede: las ventanas
// de imputa.me no salen en la barra de tareas, varias no tienen marco y alguna ni
// acepta el foco, así que el "cierra la aplicación y reintenta" salía una y otra vez.
// destroy() se salta cualquier manejador de cierre y garantiza que se van; la bandeja
// también, porque es lo último que mantiene la app en pie.
function installUpdateNow() {
  if (!autoUpdater) return;
  pauseActive(); saveData(); saveSettings();
  try { if (dockHitTimer) { clearInterval(dockHitTimer); dockHitTimer = null; } } catch {}
  try { if (tray) { tray.destroy(); tray = null; } } catch {}
  BrowserWindow.getAllWindows().forEach(w => { try { w.destroy(); } catch {} });
  // setImmediate para dejar que el ciclo de eventos procese las destrucciones antes
  // de lanzar el instalador.
  setImmediate(() => {
    try { autoUpdater.quitAndInstall(false, true); } catch {}
    // Salida a la fuerza si en unos segundos seguimos vivos. quitAndInstall lanza el
    // instalador y PIDE salir, pero si algo se resiste (un temporizador, una ventana
    // que no se fue, otro proceso de la app) el instalador se encuentra la aplicación
    // en marcha: enseña "no se puede cerrar imputa.me", y si ahí se cancela, ya ha
    // borrado los ficheros viejos y la instalación se queda inservible. Es justo lo que
    // pasó: la carpeta acabó con un icono suelto y sin ejecutable.
    setTimeout(() => { try { app.exit(0); } catch {} }, 4000);
  });
}

app.on('window-all-closed', e => e.preventDefault());
// saveSettings() explícito: saveSettingsSoon puede tener un guardado pendiente (p. ej.
// la última vista abierta) que se perdería si la app se cierra antes de que salte.
app.on('before-quit', () => {
  pauseActive(); saveData(); saveSettings();
  // La bandeja se va con la app: si se queda, el instalador que se lanza al salir
  // (autoInstallOnAppQuit) puede seguir viendo el proceso vivo y pedir que la cierres.
  try { if (tray) { tray.destroy(); tray = null; } } catch {}
});
