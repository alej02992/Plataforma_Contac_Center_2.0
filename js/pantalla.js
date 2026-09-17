/* ═══════════════════════════════════════════════════════════════════
   PANTALLA
   No conoce SIP.js. Solo reacciona a los eventos de `telefonia`.
   ═══════════════════════════════════════════════════════════════════ */

const ui = {
  sesion: null,          // datos del usuario que entregó el servicio
  llamadas: [],          // historial de la sesión
  pendiente: null,       // llamada por tipificar
  acwId: null, acwSeg: 0,
  cronoId: null,
  pausa: null,
  medidor: { stream: null, ctx: null, raf: null },
};

/* ───────── Traza ───────── */
let nLog = 0;
function log(txt, tipo = 'info') {
  const caja = $('log');
  const l = document.createElement('div');
  l.className = 'l';
  const t = new Date();
  const ts = [t.getHours(), t.getMinutes(), t.getSeconds()]
    .map((x) => String(x).padStart(2, '0')).join(':');
  l.innerHTML = `<span class="ts">${ts}</span><span class="tx tx-${tipo}"></span>`;
  l.querySelector('.tx').textContent = txt;
  caja.appendChild(l);
  if (caja.children.length > 500) caja.removeChild(caja.firstChild);
  nLog++; $('logN').textContent = nLog;
  if ($('chkSeguir').checked) caja.scrollTop = caja.scrollHeight;
}

/* ───────── Avisos ───────── */
function aviso(texto, tipo = 'av-r') {
  const d = document.createElement('div');
  d.className = 'aviso ' + tipo;
  d.innerHTML = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg><div></div>';
  d.querySelector('div').textContent = texto;
  const cont = document.querySelector('.vista.on');
  cont.insertBefore(d, cont.firstChild);
  setTimeout(() => d.remove(), 6000);
}

/* ═══════════ TONOS (WebAudio, sin archivos) ═══════════ */
const tonos = (() => {
  let ctx = null, intervalo = null, activos = [];
  const c = () => {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  };
  function sonar(frec, dur, vol = 0.12) {
    if (!$('chkTono').checked) return;
    const a = c(), g = a.createGain();
    g.gain.setValueAtTime(0, a.currentTime);
    g.gain.linearRampToValueAtTime(vol, a.currentTime + 0.01);
    g.gain.setValueAtTime(vol, a.currentTime + dur - 0.02);
    g.gain.linearRampToValueAtTime(0, a.currentTime + dur);
    g.connect(a.destination);
    frec.forEach((f) => {
      const o = a.createOscillator();
      o.frequency.value = f; o.type = 'sine'; o.connect(g);
      o.start(); o.stop(a.currentTime + dur); activos.push(o);
    });
  }
  const DTMF = { '1':[697,1209],'2':[697,1336],'3':[697,1477],'4':[770,1209],
    '5':[770,1336],'6':[770,1477],'7':[852,1209],'8':[852,1336],'9':[852,1477],
    '*':[941,1209],'0':[941,1336],'#':[941,1477] };
  return {
    pitido(d) { if (DTMF[d]) sonar(DTMF[d], 0.11, 0.09); },
    timbre() { this.parar();
      const ciclo = () => { sonar([880,660], .4, .15); setTimeout(() => sonar([880,660], .4, .15), 600); };
      ciclo(); intervalo = setInterval(ciclo, 3000); },
    llamando() { this.parar();
      const ciclo = () => sonar([440], 1, .06); ciclo(); intervalo = setInterval(ciclo, 4000); },
    parar() { if (intervalo) clearInterval(intervalo); intervalo = null;
      activos.forEach((o) => { try { o.stop(); } catch (_) {} }); activos = []; },
  };
})();

/* ═══════════ NAVEGACIÓN POR ROL ═══════════
   Cada entrada declara qué permiso necesita. El menú se arma con lo
   que el servicio devolvió para ese usuario, así que cambiar el rol de
   una persona cambia lo que ve, sin tocar código.                     */

const MENU = [
  /* ── AGENTE ──
     Un solo escritorio. Contactos, formularios e historial viven
     dentro de él, para que el agente no navegue fuera de su espacio. */
  { v:'escritorio', et:'Escritorio', permiso:'softphone',
    icono:'<rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/>' },

  /* ── SUPERVISOR ── */
  { sep:'Supervisión', permiso:'supervision' },
  { v:'supervision', et:'Seguimiento', permiso:'supervision',
    icono:'<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>' },
  { v:'campanas', et:'Campañas', permiso:'horarios',
    icono:'<path d="M3 11l18-5v12L3 14v-3z"/><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6"/>' },
  { v:'grabaciones', et:'Grabaciones', permiso:'grabaciones',
    icono:'<path d="M12 2a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"/><path d="M19 10v1a7 7 0 0 1-14 0v-1"/>' },
  { v:'escucha', et:'Escucha en línea', permiso:'escucha',
    icono:'<path d="M3 18v-6a9 9 0 0 1 18 0v6"/><path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"/>' },
  { v:'reportes', et:'Reportería', permiso:'reportes',
    icono:'<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M8 17v-3M12 17v-6M16 17v-4"/>' },

  /* ── SUPERADMINISTRADOR ── */
  { sep:'Administración', permiso:'usuarios' },
  { v:'disenador', et:'Formularios', permiso:'disenar_formularios',
    icono:'<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>' },
  { v:'admcampanas', et:'Configurar campañas', permiso:'campanas',
    icono:'<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1A1.7 1.7 0 0 0 9 19.4a1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>' },
  { v:'usuarios', et:'Usuarios y roles', permiso:'usuarios',
    icono:'<path d="M17 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9.5" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.9"/>' },
  { v:'modulos', et:'Módulos', permiso:'modulos',
    icono:'<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>' },
  { v:'diag', et:'Diagnóstico', permiso:'telefonia',
    icono:'<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>' },
  { v:'traza', et:'Traza SIP', permiso:'telefonia',
    icono:'<path d="M16 18l6-6-6-6M8 6l-6 6 6 6"/>' },
  { v:'audio', et:'Audio', permiso:'softphone', oculto:true,
    icono:'<path d="M12 2a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"/>' },
];

const TITULOS = {
  escritorio:'Escritorio', supervision:'Seguimiento de la operación',
  campanas:'Gestión de campañas', grabaciones:'Grabaciones',
  escucha:'Escucha en línea', reportes:'Reportería',
  disenador:'Diseñador de formularios', admcampanas:'Configuración de campañas',
  usuarios:'Usuarios y roles', modulos:'Módulos del sistema',
  diag:'Diagnóstico', traza:'Traza SIP', audio:'Audio',
};

/** Arma la barra lateral según los permisos del usuario. */
function construirMenu(sesion) {
  const html = [];
  MENU.forEach((m) => {
    if (m.oculto) return;
    if (m.permiso && !sesion.permisos.includes(m.permiso)) return;
    if (m.sep) { html.push(`<div class="nv-sep">${m.sep}</div>`); return; }
    html.push(
      `<button class="nv" data-v="${m.v}">` +
      `<svg viewBox="0 0 24 24">${m.icono}</svg>${m.et}` +
      (m.badge ? `<span class="badge" id="${m.badge}" style="display:none">0</span>` : '') +
      `</button>`);
  });
  $('nav').innerHTML = html.join('');
  /* El supervisor abre directamente en Seguimiento; el resto, en la
     primera entrada disponible de su menú. */
  const inicial = sesion.rol === 'supervisor' && sesion.permisos.includes('supervision')
    ? 'supervision'
    : ($('nav').querySelector('.nv')?.dataset.v || 'escritorio');
  irA(inicial);
}

$('nav').addEventListener('click', (e) => {
  const b = e.target.closest('.nv');
  if (!b) return;
  irA(b.dataset.v);
});

function irA(vista) {
  document.querySelectorAll('.nv').forEach((x) => x.classList.toggle('on', x.dataset.v === vista));
  document.querySelectorAll('.vista').forEach((v) => v.classList.toggle('on', v.dataset.v === vista));
  $('titulo').textContent = TITULOS[vista] || vista;

  // La supervisión solo corre su reloj mientras se está viendo
  if (typeof supervision !== 'undefined') {
    if (vista === 'supervision') supervision.iniciar(); else supervision.detener();
  }
  if (vista === 'reportes' && typeof supervision !== 'undefined') supervision.pintar();
  if (vista === 'formularios' && typeof formularios !== 'undefined') formularios.abrirAgente();
  if (vista === 'disenador' && typeof formularios !== 'undefined') formularios.abrirDisenador();

  if (typeof administracion !== 'undefined') {
    if (vista === 'campanas')     administracion.abrirCampanas();
    if (vista === 'grabaciones')  administracion.abrirGrabaciones();
    if (vista === 'escucha')      administracion.abrirEscucha();
    if (vista === 'admcampanas')  administracion.abrirAdmCampanas();
    if (vista === 'usuarios')     administracion.abrirUsuarios();
    if (vista === 'modulos')      administracion.abrirModulos();
  }
}

/* ═══════════ ESTADO DEL SOFTPHONE ═══════════ */
telefonia.on('traza', (d) => log(d.txt, d.tipo));
telefonia.on('error', (m) => aviso(m, 'av-r'));
telefonia.on('progreso', (m) => { $('panSm').textContent = m; });

telefonia.on('registro', (d) => {
  const el = $('regTag');
  el.classList.toggle('on', d.registrado);
  el.classList.toggle('re', !!d.reconectando);
  $('regTx').textContent = d.texto;
  $('btnCall').disabled = !d.registrado || telefonia.estado !== 'reposo';
  if (d.registrado && !ui.pausa) marcarEstadoAgente('Disponible');
  if (!d.registrado && !d.reconectando) marcarEstadoAgente('Sin conectar');
});

telefonia.on('estado', (d) => pintarSoftphone(d));
telefonia.on('insignias', (b) => pintarInsignias(b));
telefonia.on('consulta', (n) => {
  $('consBox').style.display = n ? 'block' : 'none';
  if (n) { $('consNum').textContent = n; $('trBox').style.display = 'none'; }
  pintarInsignias();
});

telefonia.on('calidad', (d) => {
  $('calidadCard').style.display = '';
  if (d.ruta) $('stRoute').textContent = d.ruta;
  if (d.codec) $('stCodec').textContent = d.codec;
  if (d.rtt) $('stRtt').textContent = d.rtt;
  if (d.perdida) $('stLoss').textContent = d.perdida;
  if (d.jitter) $('stJit').textContent = d.jitter;
  if (d.entrada) $('stIn').textContent = d.entrada;
});

telefonia.on('paso6', () => marcarPaso('s6', 'ok', 'Llamada con audio establecida'));

telefonia.on('fin', (d) => {
  if (d.contestada) {
    ui.pendiente = { ...d, hora: new Date() };
    abrirTipificador();
  } else {
    registrarLlamada({ ...d, hora: new Date(), tipificacion: null });
  }
});

function pintarSoftphone(d) {
  const e = d.estado;
  const pan = $('pan'), lb = $('panLb'), num = $('panNum'), sm = $('panSm');

  // Reiniciar la interfaz
  ['ringBox','liveBox','btnHangup','trBox'].forEach((x) => $(x).style.display = 'none');
  $('btnCall').style.display = ''; $('teclado').style.display = 'grid';
  $('flash').classList.remove('on');
  detenerCrono();
  if (e !== 'activa' && e !== 'espera') $('calidadCard').style.display = 'none';

  if (e === 'reposo') {
    if ($('tipForm').style.display === 'block' && !ui.pendiente) cerrarTipificador();
    pan.className = 'pan'; lb.textContent = 'EN REPOSO';
    num.textContent = '—'; sm.textContent = 'Sin llamada activa';
    $('spTag').className = 't o'; $('spTag').textContent = 'En reposo';
    $('spSub').textContent = 'Marca un número o espera una llamada.';
    $('btnCall').disabled = !telefonia.registrado || !!ui.pausa;
    tonos.parar(); limpiarFicha();
    ['btnMute','btnHold','btnTransfer','btnTeclado'].forEach((b) => $(b).classList.remove('on'));
  }

  if (e === 'timbrando') {
    pan.className = 'pan ring'; lb.textContent = '◉ LLAMADA ENTRANTE';
    num.textContent = d.numero; sm.textContent = 'Contesta para atender';
    $('ringBox').style.display = 'grid'; $('btnCall').style.display = 'none';
    $('teclado').style.display = 'none';
    $('spTag').className = 't a'; $('spTag').textContent = 'Entrante';
    tonos.timbre();
    if ($('chkFlash').checked) $('flash').classList.add('on');
    mostrarFicha(d.numero);
    marcarEstadoAgente('En llamada');
    if ($('chkAuto').checked) setTimeout(() => telefonia.contestar(), 700);
  }

  if (e === 'marcando') {
    pan.className = 'pan ring'; lb.textContent = 'MARCANDO…';
    num.textContent = d.numero; sm.textContent = 'Esperando respuesta';
    $('btnCall').style.display = 'none'; $('btnHangup').style.display = 'flex';
    $('teclado').style.display = 'none';
    $('spTag').className = 't a'; $('spTag').textContent = 'Marcando';
    tonos.llamando(); mostrarFicha(d.numero);
    marcarEstadoAgente('En llamada');
  }

  if (e === 'activa' || e === 'espera') {
    abrirTipificadorEnCaliente();
    pan.className = 'pan live';
    lb.textContent = e === 'espera' ? 'EN ESPERA' : 'LLAMADA ACTIVA';
    sm.textContent = e === 'espera' ? 'El cliente escucha la música' : 'Conversación en curso';
    $('liveBox').style.display = 'grid'; $('btnCall').style.display = 'none';
    $('btnHangup').style.display = 'flex'; $('teclado').style.display = 'none';
    $('spTag').className = 't b'; $('spTag').textContent = 'En llamada';
    tonos.parar(); iniciarCrono(); mostrarFicha(d.numero);
    marcarEstadoAgente('En llamada');
  }

  if (e === 'cierre') {
    pan.className = 'pan cierre'; lb.textContent = 'CIERRE DE LA INTERACCIÓN';
    num.textContent = telefonia.numero || '—';
    sm.textContent = 'Registra la tipificación';
    $('btnCall').style.display = ''; $('btnCall').disabled = true;
    $('spTag').className = 't o'; $('spTag').textContent = 'Tipificando';
    tonos.parar();
    marcarEstadoAgente('Cierre');
  }

  pintarInsignias();
}

function pintarInsignias(lista) {
  const b = lista || [];
  $('panBg').innerHTML = b.map(([c, t]) => `<span class="t ${c}">${t}</span>`).join('');
  $('btnMute').classList.toggle('on', telefonia.silenciado);
  $('btnHold').classList.toggle('on', telefonia.enEspera);
}

/* ───────── Cronómetro ───────── */
function iniciarCrono() {
  detenerCrono();
  const pintar = () => {
    const s = Math.floor((Date.now() - telefonia.inicio) / 1000);
    $('panNum').innerHTML = `<span class="tm">${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}</span>`;
  };
  pintar(); ui.cronoId = setInterval(pintar, 500);
}
function detenerCrono() { if (ui.cronoId) clearInterval(ui.cronoId); ui.cronoId = null; }

/* ═══════════ FICHA DEL CONTACTO ═══════════ */
function buscarContacto(numero) {
  const n = String(numero || '').replace(/\D/g, '');
  return DIRECTORIO.find((c) => c.n.replace(/\D/g, '') === n) || null;
}

function mostrarFicha(numero) {
  const c = buscarContacto(numero);

  if (!c) {
    $('ficha').innerHTML = `
      <div class="fi-h">
        <div class="fi-av" style="background:var(--off)">?</div>
        <div><b>Contacto no registrado</b><span>${numero || ''}</span></div>
      </div>
      <div class="aviso av-a" style="margin:0">
        <svg viewBox="0 0 24 24"><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/></svg>
        <div>Este número no está en la base. Verifica la identidad con el
        cliente y completa los datos.</div>
      </div>`;
    return;
  }

  const ini = c.nom.split(' ').filter(Boolean).slice(0, 2).map((x) => x[0]).join('');
  $('ficha').innerHTML = `
    <div class="fi-h">
      <div class="fi-av">${ini}</div>
      <div><b>${c.nom}</b><span>${c.n}</span></div>
    </div>
    <dl class="kv"><dt>Documento</dt><dd class="mono">${c.tipoDoc || ''} ${c.doc || '—'}</dd></dl>
    <dl class="kv"><dt>Correo</dt><dd>${c.cor || '—'}</dd></dl>
    <dl class="kv"><dt>Teléfono secundario</dt><dd class="mono">${c.tel2 || '—'}</dd></dl>
    <dl class="kv"><dt>Ciudad</dt><dd>${c.ciu || '—'}</dd></dl>
    <div class="ficha-et">Descripción del requerimiento</div>
    <div class="ficha-desc">${c.desc || 'Sin descripción.'}</div>`;

}

function limpiarFicha() {
  $('ficha').innerHTML = `<div class="ficha-v">
    <svg viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9.5" cy="7" r="4"/></svg>
    <p>La ficha aparece al entrar una llamada.</p></div>`;
}

/* ═══════════ TIPIFICADOR ═══════════

   Se abre en dos momentos:

   EN CALIENTE  al establecerse la llamada, para que el agente pueda
                clasificar mientras conversa. Sin cuenta regresiva.

   AL COLGAR    con el tiempo de cierre corriendo. Si ya tipificó en
                caliente, lo guardado se conserva.                     */

/* Habilita el tipificador durante la llamada, sin temporizador. */
function abrirTipificadorEnCaliente() {
  if ($('tipForm').style.display === 'block') return;   // ya está abierto
  $('tipBloq').style.display = 'none';
  $('tipForm').style.display = 'block';
  $('tipCd').style.display = 'none';                    // sin cuenta regresiva
  $('tipTag').className = 't b';
  $('tipTag').textContent = 'En caliente';
  $('btnTipGuardar').textContent = 'Guardar tipificación';
}


/* Llena el selector de resultados desde el catálogo.
   Con backend, esto vendrá de la campaña del agente. */
let catalogoActivo = CATALOGO;

async function llenarCatalogo() {
  /* Con backend, el catálogo lo define la campaña del agente. */
  try { catalogoActivo = await servicio.catalogoTipificacion(ui.sesion?.campana); }
  catch { catalogoActivo = CATALOGO; }

  $('tipCat').innerHTML = '<option value="">Selecciona…</option>' +
    Object.keys(catalogoActivo).map((c) => `<option>${c}</option>`).join('');
}

function abrirTipificador() {
  $('tipBloq').style.display = 'none';
  $('tipForm').style.display = 'block';
  $('tipCd').style.display = '';
  $('tipTag').className = 't a'; $('tipTag').textContent = 'Pendiente';

  /* Si el agente ya tipificó en caliente, no se borra lo escrito. */
  if (!$('tipCat').value) {
    $('tipObs').value = ''; $('tipAgenda').checked = false;
    $('tipSub').innerHTML = '<option value="">Selecciona el resultado primero</option>';
    $('tipSub').disabled = true;
  }
  irA('escritorio');

  ui.acwSeg = Number($('rngAcw').value) || CONFIG.acw;
  $('tipSeg').textContent = ui.acwSeg;
  clearInterval(ui.acwId);
  ui.acwId = setInterval(() => {
    ui.acwSeg--;
    $('tipSeg').textContent = ui.acwSeg;
    if (ui.acwSeg <= 0) {
      clearInterval(ui.acwId);
      aviso('Se acabó el tiempo de cierre. La llamada se guardó sin tipificar.', 'av-a');
      guardarTipificacion(true);
    }
  }, 1000);
}

$('tipCat').addEventListener('change', () => {
  const subs = catalogoActivo[$('tipCat').value] || [];
  $('tipSub').innerHTML = '<option value="">— Sin subcategoría —</option>' +
    subs.map((s) => `<option>${s}</option>`).join('');
  $('tipSub').disabled = subs.length === 0;
});

$('btnTipGuardar').addEventListener('click', () => guardarTipificacion(false));

function guardarTipificacion(porTiempo) {
  if (!porTiempo && !$('tipCat').value) {
    aviso('Selecciona un resultado antes de guardar.', 'av-a');
    return;
  }
  clearInterval(ui.acwId);
  const tip = porTiempo ? null : {
    cat: $('tipCat').value,
    sub: $('tipSub').value,
    obs: $('tipObs').value.trim(),
    agenda: $('tipAgenda').checked,
  };
  registrarLlamada({ ...ui.pendiente, tipificacion: tip });

  /* Con backend, la tipificación se envía al servidor. Si falla, la
     llamada queda registrada igual y se avisa. */
  if (tip) {
    servicio.guardarTipificacion({
      linkedid: ui.pendiente?.linkedid,
      numero: ui.pendiente?.numero,
      categoria: tip.cat, subcategoria: tip.sub,
      observaciones: tip.obs, agenda: tip.agenda,
      segundos: ui.pendiente?.segundos,
    }).then((r) => {
      if (r.enviada === false && servicio.hayApi()) {
        aviso('La tipificación se guardó localmente, pero no llegó al servidor.', 'av-a');
      }
    });
  }
  ui.pendiente = null;
  cerrarTipificador();
  telefonia.terminarCierre();
  if (!porTiempo) aviso('Tipificación guardada.', 'av-b');
}

function cerrarTipificador() {
  $('tipForm').style.display = 'none';
  $('tipBloq').style.display = 'block';
  $('tipTag').className = 't o'; $('tipTag').textContent = 'Sin llamada';
}

/* ═══════════ HISTORIAL ═══════════ */
function registrarLlamada(ll) {
  ui.llamadas.unshift(ll);
  pintarHistorial();
}

function pintarHistorial() {
  const n = ui.llamadas.length;
  $('histN').textContent = n;

  const badge = $('navHist');          // solo existe si el rol ve el historial
  if (badge) { badge.style.display = n ? '' : 'none'; badge.textContent = n; }

  if (!n) {
    $('histTabla').innerHTML = '<div class="vacio">Todavía no hay llamadas.</div>';
    return;
  }

  const clase = (l) => !l.contestada && l.direccion === 'entrante' ? 'perd'
                     : l.direccion === 'entrante' ? 'ent' : 'sal';
  const etq = (c) => c === 'perd' ? 'Perdida' : c === 'ent' ? 'Entrante' : 'Saliente';
  const dur = (l) => l.contestada
    ? `${String(Math.floor(l.segundos / 60)).padStart(2, '0')}:${String(l.segundos % 60).padStart(2, '0')}`
    : '—';
  const nom = (l) => (buscarContacto(l.numero)?.nom) || 'No identificado';
  const tip = (l) => l.tipificacion
    ? l.tipificacion.cat + (l.tipificacion.sub ? ' · ' + l.tipificacion.sub : '')
    : '<span style="color:var(--ink-3)">Sin tipificar</span>';

  $('histTabla').innerHTML = `<table class="tb">
    <tr><th>Hora</th><th>Número</th><th>Contacto</th><th>Tipo</th><th>Duración</th><th>Tipificación</th></tr>
    ${ui.llamadas.map((l) => {
      const c = clase(l);
      return `<tr>
        <td class="mono">${l.hora.toLocaleTimeString('es-CO')}</td>
        <td class="mono">${l.numero || '—'}</td>
        <td>${nom(l)}</td>
        <td><span class="t ${c === 'perd' ? 'r' : c === 'ent' ? 'b' : 'g'}">${etq(c)}</span></td>
        <td class="mono">${dur(l)}</td>
        <td>${tip(l)}</td></tr>`;
    }).join('')}</table>`;
}

/* ═══════════ ESTADO DEL AGENTE Y PAUSAS ═══════════ */
function marcarEstadoAgente(texto) {
  const el = $('estAg');
  el.className = 'est ' + (
    texto === 'Disponible' ? 'est-ok' :
    texto === 'En llamada' ? 'est-llamada' :
    texto === 'Cierre' ? 'est-llamada' :
    texto === 'Sin conectar' ? 'est-off' : 'est-pausa');
  $('estAgTx').textContent = texto;
}

$('pausas').addEventListener('click', (e) => {
  const b = e.target.closest('.pz');
  if (!b) return;
  if (telefonia.estado !== 'reposo') {
    aviso('No puedes entrar en pausa con una llamada en curso.', 'av-a');
    return;
  }
  ui.pausa = b.dataset.p;
  telefonia.pausa = ui.pausa;
  document.querySelectorAll('.pz').forEach((x) => x.classList.toggle('on', x === b));
  marcarEstadoAgente(ui.pausa);
  $('btnCall').disabled = true;
  telefonia.traza('Agente en pausa: ' + ui.pausa, 'info');
  servicio.registrarPausa(ui.pausa, true);
});

$('btnDisponible').addEventListener('click', () => {
  ui.pausa = null; telefonia.pausa = null;
  document.querySelectorAll('.pz').forEach((x) => x.classList.remove('on'));
  marcarEstadoAgente(telefonia.registrado ? 'Disponible' : 'Sin conectar');
  $('btnCall').disabled = !telefonia.registrado || telefonia.estado !== 'reposo';
  telefonia.traza('Agente disponible', 'info');
  servicio.registrarPausa(null, false);
});

/* ═══════════ TECLADO ═══════════ */
function pulsar(d) {
  const enLlamada = telefonia.estado === 'activa' || telefonia.estado === 'espera';
  if (enLlamada) { telefonia.tono(d); tonos.pitido(d); }
  else { $('dest').value += d; tonos.pitido(d); }
}

$('teclado').addEventListener('click', (e) => {
  const t = e.target.closest('.tk');
  if (t) pulsar(t.dataset.d);
});

$('btnBorrar').addEventListener('click', () => {
  $('dest').value = $('dest').value.slice(0, -1);
});

$('btnTeclado').addEventListener('click', () => {
  const t = $('teclado');
  const vis = t.style.display !== 'none';
  t.style.display = vis ? 'none' : 'grid';
  $('btnTeclado').classList.toggle('on', !vis);
});

document.addEventListener('keydown', (e) => {
  if ($('app').classList.contains('on') === false) return;
  const enCampo = /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName);
  if (e.ctrlKey || e.altKey || e.metaKey) return;

  if (e.key === 'Enter') {
    if (telefonia.estado === 'timbrando') { telefonia.contestar(); e.preventDefault(); return; }
    if (telefonia.estado === 'reposo' && (e.target === $('dest') || !enCampo)) {
      telefonia.llamar($('dest').value); e.preventDefault(); return;
    }
  }
  if (e.key === 'Escape' && telefonia.estado !== 'reposo' && telefonia.estado !== 'cierre') {
    telefonia.colgar(); return;
  }
  if (!enCampo && /^[0-9*#]$/.test(e.key)) {
    pulsar(e.key);
    const t = [...document.querySelectorAll('.tk')].find((k) => k.dataset.d === e.key);
    if (t) { t.classList.add('hit'); setTimeout(() => t.classList.remove('hit'), 130); }
  }
});

/* ═══════════ BOTONES DE LLAMADA ═══════════ */
$('btnCall').addEventListener('click', () => telefonia.llamar($('dest').value));
$('btnAnswer').addEventListener('click', () => telefonia.contestar());
$('btnReject').addEventListener('click', () => telefonia.rechazar());
$('btnHangup').addEventListener('click', () => telefonia.colgar());
$('btnMute').addEventListener('click', () => telefonia.silenciar(!telefonia.silenciado));
$('btnHold').addEventListener('click', () => telefonia.espera(!telefonia.enEspera));

/* ── Transferencia: extensión, campaña o número externo ────────── */

let trTipo = 'campana';
let trAgenteSel = null;

$('btnTransfer').addEventListener('click', () => {
  const v = $('trBox').style.display !== 'none';
  $('trBox').style.display = v ? 'none' : 'block';
  $('btnTransfer').classList.toggle('on', !v);
  if (!v) { llenarCampanasTransferencia(); pintarAgentesTransferencia(); }
});

$('btnTrCancel').addEventListener('click', () => {
  $('trBox').style.display = 'none'; $('btnTransfer').classList.remove('on');
});

/* Pestañas del destino */
$('trTabs').addEventListener('click', (e) => {
  const t = e.target.closest('.tab');
  if (!t) return;
  trTipo = t.dataset.t;
  document.querySelectorAll('#trTabs .tab').forEach((x) => x.classList.toggle('on', x === t));
  $('trPanelCampana').style.display   = trTipo === 'campana'   ? '' : 'none';
  $('trPanelAgente').style.display    = trTipo === 'agente'    ? '' : 'none';
  $('trPanelExtension').style.display = trTipo === 'extension' ? '' : 'none';
  $('trPanelExterno').style.display   = trTipo === 'externo'   ? '' : 'none';
  if (trTipo === 'agente') pintarAgentesTransferencia();
});

/* Compañeros conectados, con su estado, para transferirles la llamada.
   No se ofrece a quien esté en llamada o en pausa. */
function pintarAgentesTransferencia() {
  const yo = ui.sesion?.usuario;
  const vivos = servicio.estadoVivo().agentes
    .filter((a) => a.ext && a.usuario !== yo);

  if (!vivos.length) {
    $('trAgentes').innerHTML = '<div class="vacio">No hay compañeros conectados.</div>';
    return;
  }

  const color = (e) => e === 'Disponible' ? 'g' : e === 'En llamada' ? 'b' : 'a';
  $('trAgentes').innerHTML = vivos.map((a) => {
    const libre = a.estado === 'Disponible';
    return `<button class="ag-tr ${trAgenteSel === a.ext ? 'sel' : ''}"
              data-ag="${a.ext}" ${libre ? '' : 'disabled'}>
        <div class="bd"><b>${a.nombre}</b><span>ext. ${a.ext} · ${a.campana}</span></div>
        <span class="t ${color(a.estado)}">${a.estado}</span>
      </button>`;
  }).join('');
}

$('trAgentes').addEventListener('click', (e) => {
  const b = e.target.closest('[data-ag]');
  if (!b || b.disabled) return;
  trAgenteSel = b.dataset.ag;
  pintarAgentesTransferencia();
});

function llenarCampanasTransferencia() {
  if ($('trCampana').options.length) return;
  $('trCampana').innerHTML = servicio.campanas
    .map((c) => `<option value="${c.cola}">${c.nombre} — cola ${c.cola}</option>`).join('');
}

/* Sugerencia de extensión mientras se escribe */
$('trExt').addEventListener('input', () => {
  const v = $('trExt').value.trim();
  const u = servicio.usuarios.find((x) => x.extension === v);
  $('trExtHint').textContent = u ? u.nombre + ' · ' + u.campana
    : (v ? 'Extensión no encontrada en el directorio' : '');
});

/* Validación de números externos colombianos.
   Celular: 10 dígitos que empiezan por 3.
   Fijo:    indicativo 60 + 1 dígito de ciudad + 7 dígitos.            */
function validarExterno(numero) {
  const n = String(numero).replace(/\D/g, '');
  if (/^3\d{9}$/.test(n))    return { ok: true, tipo: 'Celular', numero: n };
  if (/^60\d{8}$/.test(n))   return { ok: true, tipo: 'Fijo', numero: n };
  if (/^\d{7}$/.test(n))     return { ok: true, tipo: 'Fijo local', numero: n };
  return { ok: false, motivo: 'No parece un celular (10 dígitos desde 3) ni un fijo (60 + 8 dígitos).' };
}

$('trExterno').addEventListener('input', () => {
  const v = $('trExterno').value.trim();
  if (!v) { $('trExternoHint').textContent = 'Celular: 10 dígitos. Fijo: 60 + 8 dígitos.'; return; }
  const r = validarExterno(v);
  $('trExternoHint').textContent = r.ok
    ? r.tipo + ' · sale por la troncal y consume un canal'
    : r.motivo;
});

/** Devuelve el destino según la pestaña activa, o null si no es válido. */
function destinoTransferencia() {
  if (trTipo === 'agente') {
    if (!trAgenteSel) { aviso('Selecciona un compañero disponible.', 'av-a'); return null; }
    const a = servicio.usuarios.find((x) => x.extension === trAgenteSel);
    return { destino: trAgenteSel, etiqueta: a ? a.nombre : 'extensión ' + trAgenteSel };
  }

  if (trTipo === 'extension') {
    const d = $('trExt').value.trim();
    if (!d) { aviso('Escribe la extensión de destino.', 'av-a'); return null; }
    return { destino: d, etiqueta: 'extensión ' + d };
  }

  if (trTipo === 'campana') {
    const cola = $('trCampana').value;
    if (!cola) { aviso('Selecciona una campaña.', 'av-a'); return null; }
    const c = servicio.campanas.find((x) => x.cola === cola);
    if (c && !c.abierta) {
      aviso(`La campaña ${c.nombre} está cerrada. La llamada quedaría sin atender.`, 'av-a');
      return null;
    }
    return { destino: cola, etiqueta: 'campaña ' + (c ? c.nombre : cola) };
  }

  // Externo
  const r = validarExterno($('trExterno').value);
  if (!r.ok) { aviso(r.motivo, 'av-a'); return null; }
  return { destino: r.numero, etiqueta: r.tipo + ' ' + r.numero, externo: true };
}

$('btnTrCiega').addEventListener('click', () => {
  const d = destinoTransferencia();
  if (!d) return;
  telefonia.transferirCiega(d.destino);
  aviso('Transferencia ciega enviada a ' + d.etiqueta + '.', 'av-b');
  $('trBox').style.display = 'none';
  $('btnTransfer').classList.remove('on');
});

$('btnTrCons').addEventListener('click', () => {
  const d = destinoTransferencia();
  if (!d) return;
  if (d.externo) {
    aviso('Consultando con ' + d.etiqueta + '. La llamada sale por la troncal.', 'av-b');
  }
  telefonia.transferirConsultada(d.destino);
});
$('btnUnir').addEventListener('click', () => telefonia.unir());
$('btnVolver').addEventListener('click', () => telefonia.cancelarConsulta());

/* ═══════════ AUDIO ═══════════ */
async function cargarDispositivos() {
  try {
    const disp = await navigator.mediaDevices.enumerateDevices();
    const llenar = (sel, lista, etq) => {
      const prev = sel.value;
      sel.innerHTML = lista.length
        ? lista.map((d, i) => `<option value="${d.deviceId}">${d.label || etq + ' ' + (i+1)}</option>`).join('')
        : `<option value="">Sin ${etq} disponible</option>`;
      if (prev && [...sel.options].some((o) => o.value === prev)) sel.value = prev;
    };
    llenar($('selMic'), disp.filter((d) => d.kind === 'audioinput'), 'micrófono');
    llenar($('selOut'), disp.filter((d) => d.kind === 'audiooutput'), 'salida');
    if (!('setSinkId' in HTMLMediaElement.prototype)) {
      $('selOut').disabled = true;
      $('hintOut').textContent = 'Este navegador no permite elegir la salida. Cámbiala en el sistema.';
    }
  } catch (e) { log('No se pudieron leer los dispositivos: ' + e.message, 'warn'); }
}

$('selMic').addEventListener('change', () => {
  if (telefonia.cfg) telefonia.cfg.mic = $('selMic').value;
  iniciarMedidor();
});
$('selOut').addEventListener('change', () => {
  if (telefonia.cfg) telefonia.cfg.salida = $('selOut').value;
  const el = $('audioRemoto');
  if (el.setSinkId && $('selOut').value) el.setSinkId($('selOut').value).catch(() => {});
});
$('rngVol').addEventListener('input', () => {
  const v = Number($('rngVol').value);
  $('volVal').textContent = v + '%';
  $('audioRemoto').volume = v / 100;
  if (telefonia.cfg) telefonia.cfg.volumen = v;
});
$('rngAcw').addEventListener('input', () => { $('acwVal').textContent = $('rngAcw').value + ' s'; });

async function iniciarMedidor() {
  detenerMedidor();
  try {
    const mic = $('selMic').value;
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: mic ? { deviceId: { exact: mic } } : true });
    ui.medidor.stream = stream;
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    ui.medidor.ctx = ctx;
    const an = ctx.createAnalyser(); an.fftSize = 512;
    ctx.createMediaStreamSource(stream).connect(an);
    const datos = new Uint8Array(an.frequencyBinCount);
    const pintar = () => {
      an.getByteTimeDomainData(datos);
      let suma = 0;
      for (let i = 0; i < datos.length; i++) { const v = (datos[i] - 128) / 128; suma += v * v; }
      const pct = Math.min(100, Math.round(Math.sqrt(suma / datos.length) * 260));
      $('vuBar').style.width = pct + '%';
      $('vuVal').textContent = pct > 2 ? pct + '%' : '—';
      ui.medidor.raf = requestAnimationFrame(pintar);
    };
    pintar();
  } catch (e) { log('Medidor no disponible: ' + e.message, 'warn'); }
}

function detenerMedidor() {
  if (ui.medidor.raf) cancelAnimationFrame(ui.medidor.raf);
  ui.medidor.stream?.getTracks().forEach((t) => t.stop());
  ui.medidor.ctx?.close().catch(() => {});
  ui.medidor = { stream: null, ctx: null, raf: null };
  $('vuBar').style.width = '0%';
}

$('btnProbar').addEventListener('click', () => {
  const c = new (window.AudioContext || window.webkitAudioContext)();
  const dest = c.createMediaStreamDestination(), g = c.createGain();
  g.gain.value = (Number($('rngVol').value) / 100) * 0.18;
  g.connect(dest);
  [523, 659, 784].forEach((f, i) => {
    const o = c.createOscillator();
    o.frequency.value = f; o.type = 'sine'; o.connect(g);
    o.start(c.currentTime + i * 0.22); o.stop(c.currentTime + i * 0.22 + 0.2);
  });
  const el = new Audio(); el.srcObject = dest.stream;
  if (el.setSinkId && $('selOut').value) el.setSinkId($('selOut').value).catch(() => {});
  el.play().catch(() => {});
  setTimeout(() => { el.pause(); c.close().catch(() => {}); }, 1400);
  aviso('¿Escuchaste tres notas?', 'av-b');
});

/* ═══════════ DIAGNÓSTICO ═══════════ */
function marcarPaso(id, estado, msg) {
  const el = $(id);
  if (!el) return;
  el.classList.remove('ok', 'bad', 'warn', 'run');
  el.classList.add(estado);
  el.querySelector('.res').textContent = msg;
}

$('btnDiag').addEventListener('click', async () => {
  const b = $('btnDiag');
  b.disabled = true; b.textContent = 'Ejecutando…';
  const cfg = telefonia.cfg || {};

  // 1. Contexto seguro
  marcarPaso('s1', window.isSecureContext ? 'ok' : 'bad',
    window.isSecureContext ? 'Contexto seguro · ' + location.origin
      : 'NO es contexto seguro · ' + (location.origin || 'file://') + ' — usa http://localhost o HTTPS');

  // 2. Micrófono
  try {
    const st = await navigator.mediaDevices.getUserMedia({ audio: true });
    const et = st.getAudioTracks()[0]?.label || 'desconocido';
    st.getTracks().forEach((t) => t.stop());
    await cargarDispositivos();
    marcarPaso('s2', 'ok', 'Micrófono OK · ' + et);
  } catch (e) {
    marcarPaso('s2', 'bad', e.name + ': ' +
      (e.name === 'NotAllowedError' ? 'permiso bloqueado' :
       e.name === 'NotFoundError' ? 'no hay micrófono' : e.message));
  }

  // 3. WebSocket
  if (!cfg.wss || cfg.simulado) {
    marcarPaso('s3', 'warn', 'La central no está configurada en js/config.js');
  } else {
    await new Promise((res) => {
      marcarPaso('s3', 'run', 'Conectando…');
      let listo = false;
      const t0 = performance.now();
      let ws;
      try { ws = new WebSocket(cfg.wss, 'sip'); }
      catch (e) { marcarPaso('s3', 'bad', e.message); return res(); }
      const lim = setTimeout(() => {
        if (listo) return; listo = true;
        try { ws.close(); } catch (_) {}
        marcarPaso('s3', 'bad', 'Sin respuesta en 8 s — puerto cerrado, certificado inválido o WebSocket deshabilitado');
        res();
      }, 8000);
      ws.onopen = () => { if (listo) return; listo = true; clearTimeout(lim);
        marcarPaso('s3', 'ok', 'Conectado en ' + Math.round(performance.now() - t0) + ' ms');
        try { ws.close(1000); } catch (_) {} res(); };
      ws.onerror = () => { if (listo) return; listo = true; clearTimeout(lim);
        marcarPaso('s3', 'bad', 'Rechazado. Abre https://' +
          cfg.wss.replace(/^wss:\/\//, '').split('/')[0] + ' en otra pestaña para ver si es el certificado.');
        res(); };
    });
  }

  // 4. Registro
  marcarPaso('s4', telefonia.registrado ? 'ok' : 'bad',
    telefonia.registrado ? 'Extensión registrada' : 'Sin registrar');

  // 5. ICE
  await probarCandidatosIce();
  b.disabled = false; b.textContent = 'Ejecutar';
});

// Prueba de candidatos ICE
function probarCandidatosIce() {
  return new Promise((res) => {
    marcarPaso('s5', 'run', 'Recolectando candidatos…');
    const enc = { host: 0, srflx: 0, relay: 0 };
    let pc;
    try {
      pc = new RTCPeerConnection({ iceServers: CONFIG.pbx.ice });
    } catch (e) { marcarPaso('s5', 'bad', e.message); return res(); }
    pc.createDataChannel('probe');
    const fin = () => {
      try { pc.close(); } catch (_) {}
      const r = `host: ${enc.host} · STUN: ${enc.srflx} · TURN: ${enc.relay}`;
      if (enc.relay) marcarPaso('s5', 'ok', r + ' — TURN disponible, cobertura completa');
      else if (enc.srflx) marcarPaso('s5', 'warn', r + ' — sin TURN: fallará con firewalls estrictos');
      else if (enc.host) marcarPaso('s5', 'warn', r + ' — solo red local: el audio fallará fuera de la sede');
      else marcarPaso('s5', 'bad', 'Sin candidatos ICE');
      res();
    };
    pc.onicecandidate = (ev) => {
      if (!ev.candidate) return fin();
      const t = ev.candidate.type || 'host';
      if (enc[t] !== undefined) enc[t]++;
    };
    pc.createOffer({ offerToReceiveAudio: true })
      .then((o) => pc.setLocalDescription(o))
      .catch((e) => { marcarPaso('s5', 'bad', e.message); res(); });
    setTimeout(() => { if (pc.iceGatheringState !== 'complete') fin(); }, 6000);
  });
}

/* ═══════════ TRAZA: LIMPIAR Y DESCARGAR ═══════════ */
$('btnLimpiar').addEventListener('click', () => {
  $('log').innerHTML = ''; nLog = 0; $('logN').textContent = '0';
});

$('btnDescargar').addEventListener('click', () => {
  const cfg = telefonia.cfg || {};
  const cab = [
    'BPM CONSULTING — ESCRITORIO DEL AGENTE',
    '='.repeat(58),
    'Fecha:     ' + new Date().toLocaleString('es-CO'),
    'Navegador: ' + navigator.userAgent,
    'Origen:    ' + location.origin,
    'WebSocket: ' + (cfg.wss || '(sin configurar)'),
    'Extensión: ' + (cfg.ext || '—'),
    'Llamadas de la sesión: ' + ui.llamadas.length,
    '', '='.repeat(58), 'TRAZA SIP', '='.repeat(58), '',
  ].join('\n');
  const lineas = [...$('log').querySelectorAll('.l')]
    .map((l) => l.querySelector('.ts').textContent + '  ' + l.querySelector('.tx').textContent);
  const blob = new Blob([cab + lineas.join('\n')], { type: 'text/plain;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'bpm-traza-' + new Date().toISOString().slice(0, 16).replace(/[:T]/g, '') + '.txt';
  a.click();
  URL.revokeObjectURL(a.href);
});

/* ═══════════ CONEXIÓN Y CIERRE DE SESIÓN ═══════════ */

function errorLogin(msg) {
  $('loginErr').innerHTML = msg
    ? `<div class="aviso av-r" style="margin-bottom:0;align-items:flex-start"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg><div>${msg}</div></div>`
    : '';
}

/* ── Iniciar sesión ──────────────────────────────────────────────
   El agente solo aporta usuario y contraseña. La extensión y la
   credencial SIP las entrega el servicio: el agente nunca las ve.   */
async function entrar() {
  const usuario = $('inUsuario').value.trim();
  const clave = $('inClave').value;

  if (!usuario) return errorLogin('Escribe tu usuario.');
  if (!clave) return errorLogin('Escribe tu contraseña.');
  errorLogin('');

  const btn = $('btnEntrar');
  btn.disabled = true; btn.textContent = 'Iniciando sesión…';

  let sesion, credencial, simulado = false;

  try {
    // 1. Autenticar contra la plataforma
    sesion = await servicio.autenticar(usuario, clave);
    log(`Sesión iniciada: ${sesion.nombre} (${sesion.rol})`, 'ok');

    /* Primer acceso o contraseña restablecida: se pide el cambio ANTES
       de registrar la extensión. No tiene sentido conectar la telefonía
       de alguien que todavía no ha definido su contraseña, y así un
       fallo de la central no le impide cambiarla. */
    if (sesion.debeCambiarClave) {
      ui.sesionPendiente = sesion;
      $('login').style.display = 'none';
      $('cambioClave').style.display = '';
      $('ccActual').value = clave;      // ya la escribió al entrar
      $('ccNueva').focus();
      btn.disabled = false; btn.textContent = 'Iniciar sesión';
      return;
    }

    // 2. Pedir la credencial SIP temporal
    if (!sesion.extension) {
      /* Supervisor y administrador no requieren softphone para su
         operación diaria. Registrarlos sin extensión fallaría y les
         impediría entrar. */
      simulado = true;
      log('Perfil sin extensión asignada: la sesión inicia sin softphone', 'info');
    } else {
      try {
        credencial = await servicio.credencialSip(sesion);
        log(`Credencial SIP recibida para la extensión ${credencial.ext}`, 'ok');
      } catch (e) {
        if (e.message !== 'SIN_PBX') throw e;
        // Sin central configurada: la sesión sigue, pero sin telefonía real
        simulado = true;
        log('Central no configurada: la sesión inicia sin telefonía', 'warn');
      }
    }

    // 3. Conectar el softphone con lo que entregó el servicio
    await telefonia.conectar({
      nombre: sesion.nombre,
      campana: sesion.campana,
      wss: credencial?.wss,
      dominio: credencial?.dominio,
      ext: credencial?.ext ?? sesion.extension,
      clave: credencial?.clave,
      ice: credencial?.ice,
      volumen: 100,
      simulado,
    });

  } catch (e) {
    errorLogin(e.message || 'No se pudo iniciar sesión.');
    btn.disabled = false; btn.textContent = 'Iniciar sesión';
    return;
  }

  // 4. Montar la aplicación
  await montarAplicacion(sesion, simulado);
  btn.disabled = false; btn.textContent = 'Iniciar sesión';
}

/* Arma el escritorio y lo muestra. Se llama al iniciar sesión y
   también después del cambio obligatorio de contraseña. */
async function montarAplicacion(sesion, simulado) {
  try {
    ui.sesion = sesion;
    $('uNombre').textContent = sesion.nombre;
    $('uExt').innerHTML = `Ext. ${sesion.extension || '—'} · ${sesion.campana || ''}` +
      `<span class="cred">${etiquetaRol(sesion.rol)}</span>`;
    $('uAv').textContent = sesion.nombre.split(' ').filter(Boolean).slice(0, 2)
      .map((x) => x[0]).join('').toUpperCase();

    construirMenu(sesion);      // el menú depende del rol
    llenarCatalogo();
    pintarHistorial();
    formularios.pintarPendientes();

    // Solo cuando todo lo anterior salió bien se cambia de pantalla
    $('login').style.display = 'none';
    $('cambioClave').style.display = 'none';
    $('app').classList.add('on');
  } catch (e) {
    console.error('BPM · error al montar la aplicación:', e);
    errorLogin('Error al abrir la plataforma: ' + e.message +
      '<br><br>Abre la consola con F12 para ver el detalle.');
    return;
  }

  // El micrófono es opcional para entrar: si falla, se avisa pero no bloquea
  try {
    await cargarDispositivos();
    iniciarMedidor();
  } catch (e) {
    log('No se pudo acceder al micrófono: ' + e.message, 'warn');
  }

  if (simulado) {
    log('Central no configurada: el softphone trabaja sin telefonía real', 'warn');
  }
}

const ROLES = { agente: 'Agente', supervisor: 'Supervisor', admin: 'Administrador' };
const etiquetaRol = (r) => ROLES[r] || r;

$('btnEntrar').addEventListener('click', () => entrar());
$('inUsuario').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('inClave').focus(); });
$('inClave').addEventListener('keydown', (e) => { if (e.key === 'Enter') entrar(); });

$('btnSalir').addEventListener('click', async () => {
  if (telefonia.estado !== 'reposo') {
    aviso('Termina la llamada antes de cerrar sesión.', 'av-a');
    return;
  }
  detenerMedidor(); tonos.parar();
  await telefonia.desconectar();
  await servicio.cerrar();   // el backend real invalida aquí la credencial SIP
  location.reload();
});

/* Con el simulador activo (js/config.js), Ctrl+Shift+L genera una
   llamada entrante. No aparece en la interfaz: es una ayuda de
   desarrollo, no una función del producto. */
document.addEventListener('keydown', (e) => {
  if (e.ctrlKey && e.shiftKey && (e.key === 'L' || e.key === 'l')) {
    e.preventDefault();
    telefonia.simularEntrante();
  }
});

/* ═══════════ SUPERVISIÓN: BOTONES ═══════════ */

$('filtroCampana').addEventListener('change', () => {
  supervision.fijarFiltro($('filtroCampana').value);
});

$('tablaCampanas').addEventListener('click', (e) => {
  const b = e.target.closest('[data-hor]');
  if (!b || !b.dataset.hor) return;
  const h = supervision.alternarHorario(b.dataset.hor);
  if (h) aviso(`${h.campana}: campaña ${h.abierto ? 'abierta' : 'cerrada'}.`, 'av-b');
});

$('listaReportes').addEventListener('click', (e) => {
  const b = e.target.closest('.rep');
  if (!b) return;
  supervision.generar(b.dataset.rep);
});

$('btnDescargarCsv').addEventListener('click', () => supervision.descargarCsv());

/* ═══════════ CAMBIO DE CONTRASEÑA ═══════════ */

function errorCambio(msg) {
  $('ccErr').innerHTML = msg
    ? `<div class="aviso av-r" style="margin-bottom:0;align-items:flex-start"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg><div>${msg}</div></div>`
    : '';
}

async function cambiarClave() {
  const actual = $('ccActual').value;
  const nueva  = $('ccNueva').value;
  const repite = $('ccRepite').value;

  if (!actual)             return errorCambio('Escribe tu contraseña actual.');
  if (nueva.length < 8)    return errorCambio('La nueva contraseña debe tener al menos 8 caracteres.');
  if (nueva !== repite)    return errorCambio('Las dos contraseñas nuevas no coinciden.');
  if (nueva === actual)    return errorCambio('La nueva contraseña debe ser distinta de la actual.');
  errorCambio('');

  const btn = $('btnCambiarClave');
  btn.disabled = true; btn.textContent = 'Guardando…';

  try {
    await servicio.cambiarMiClave(actual, nueva);
  } catch (e) {
    errorCambio(e.message || 'No se pudo cambiar la contraseña.');
    btn.disabled = false; btn.textContent = 'Guardar y continuar';
    return;
  }

  /* Cambiada: se entra con la sesión que quedó esperando. */
  $('cambioClave').style.display = 'none';
  $('ccActual').value = $('ccNueva').value = $('ccRepite').value = '';
  btn.disabled = false; btn.textContent = 'Guardar y continuar';

  /* Con la contraseña ya definida, se completa el inicio de sesión:
     credencial SIP, softphone y escritorio. */
  const sesion = ui.sesionPendiente;
  ui.sesionPendiente = null;
  if (!sesion) return;

  sesion.debeCambiarClave = false;
  let credencial, simulado = false;

  /* Un usuario sin extensión no se registra en la central. Es el caso
     del supervisor y del administrador, que no requieren softphone
     para su operación diaria. Intentar registrarlos produciría un
     fallo que además impediría el ingreso. */
  if (!sesion.extension) {
    simulado = true;
    log('Este perfil no tiene extensión asignada: entra sin softphone', 'info');
  } else {
    try {
      credencial = await servicio.credencialSip(sesion);
    } catch (e) {
      if (e.message !== 'SIN_PBX') {
        log('No se pudo obtener la credencial SIP: ' + e.message, 'warn');
      }
      simulado = true;
    }
  }

  try {
    await telefonia.conectar({
      nombre: sesion.nombre, campana: sesion.campana,
      wss: credencial?.wss, dominio: credencial?.dominio,
      ext: credencial?.ext ?? sesion.extension,
      clave: credencial?.clave, ice: credencial?.ice,
      volumen: 100, simulado,
    });
  } catch (e) {
    log('No se pudo conectar el softphone: ' + e.message, 'warn');
  }

  await montarAplicacion(sesion, simulado);
  aviso('Contraseña actualizada. Bienvenido.', 'av-b');
}

$('btnCambiarClave').addEventListener('click', cambiarClave);
[$('ccActual'), $('ccNueva'), $('ccRepite')].forEach((el) =>
  el.addEventListener('keydown', (e) => { if (e.key === 'Enter') cambiarClave(); }));

/* ═══════════ ARRANQUE ═══════════ */

/* Red de seguridad: cualquier error no capturado se muestra en pantalla.
   Sin esto, un fallo se queda solo en la consola y la interfaz parece
   no responder. */
window.addEventListener('error', (ev) => {
  const msg = ev.message || 'Error desconocido';
  if ($('login').style.display !== 'none') {
    errorLogin('Se produjo un error: ' + msg + '<br><br>' +
      (ev.filename ? 'Archivo: ' + ev.filename.split('/').pop() +
       ', línea ' + ev.lineno : '') +
      '<br>Abre la consola con F12 para ver el detalle.');
    $('btnEntrar').disabled = false;
    $('btnEntrar').textContent = 'Iniciar sesión';
  } else {
    aviso('Se produjo un error: ' + msg, 'av-r');
  }
});

window.addEventListener('unhandledrejection', (ev) => {
  const msg = ev.reason?.message || String(ev.reason);
  console.error('BPM · promesa rechazada sin capturar:', ev.reason);
  if ($('login').style.display !== 'none') {
    errorLogin('Se produjo un error: ' + msg +
      '<br><br>Abre la consola con F12 para ver el detalle.');
    $('btnEntrar').disabled = false;
    $('btnEntrar').textContent = 'Iniciar sesión';
  }
});

(function inicio() {
  /* Cada archivo define un objeto global. Si falta uno, decimos
     exactamente cuál para no tener que adivinar. */
  const PIEZAS = [
    ['CONFIG',      'js/config.js'],
    ['servicio',    'js/servicio.js'],
    ['telefonia',   'js/telefonia.js'],
    ['supervision', 'js/supervision.js'],
    ['formularios', 'js/formularios.js'],
  ];

  const faltan = PIEZAS.filter(([g]) => {
    try { return eval('typeof ' + g) === 'undefined'; } catch { return true; }
  }).map(([, archivo]) => archivo);

  if (faltan.length) {
    errorLogin(
      'No se cargaron estos archivos: <b>' + faltan.join('</b>, <b>') + '</b>.<br><br>' +
      'Revisa que existan en la carpeta y que estén en su subcarpeta correcta ' +
      '(<b>js/</b> y <b>lib/</b>). Abre la consola con F12 y mira la pestaña Red: ' +
      'los archivos que no se encontraron aparecen en rojo.');
    $('btnEntrar').disabled = true;
    console.error('BPM · archivos que no cargaron:', faltan);
    return;
  }

  /* Estado de la telefonía, visible desde el primer momento */
  const haySip = typeof SIP !== 'undefined' && typeof SIP.UserAgent === 'function';

  if (!haySip) {
    errorLogin('No se cargó <b>lib/sip.js</b>.<br><br>' +
      'La plataforma funciona, pero las llamadas serán simuladas. ' +
      'Verifica que el archivo exista dentro de la carpeta <b>lib</b> ' +
      'y pese <b>602.865 bytes</b>.');
  } else if (!CONFIG.pbx.wss || !CONFIG.pbx.dominio) {
    log('Librería cargada. Falta configurar la central en js/config.js', 'warn');
  } else if (CONFIG.simulador) {
    log('Librería y central listas, pero simulador está en true', 'warn');
  } else {
    log('Telefonía real activa · ' + CONFIG.pbx.wss, 'ok');
  }

  if (!window.isSecureContext) {
    errorLogin('Esta página debe abrirse desde https:// o http://localhost. ' +
      'De lo contrario el navegador bloquea el micrófono.');
  }

  $('inUsuario').focus();

  log('BPM Consulting — Contact Center', 'ok');
  log(servicio.hayApi()
    ? 'Backend conectado: ' + CONFIG.api
    : 'Sin backend: datos locales (js/servicio.js)', servicio.hayApi() ? 'ok' : 'warn');
  log(servicio.hayPbxConfigurada()
    ? 'Central configurada: ' + CONFIG.pbx.wss
    : 'Central no configurada (js/config.js)', 'info');
})();