/* ═══════════════════════════════════════════════════════════════════
   BPM CONSULTING — ADMINISTRACIÓN Y SUPERVISIÓN

   Todo lo que pidieron los tres perfiles y no existía:

     SUPERVISOR    horarios de campaña, distribución de agentes,
                   grabaciones con reproductor, escucha en línea.

     SUPERADMIN    configuración de campañas con DID y formulario,
                   usuarios con cambio de rol de un clic,
                   interruptor maestro de módulos.

   No toca la telefonía. Solo lee el estado que expone `telefonia`.
   ═══════════════════════════════════════════════════════════════════ */
'use strict';

const administracion = (() => {

  /* ── Datos que en producción vienen del backend ─────────────── */

  const MODULOS = [
    { id:'calidad',    nom:'Calidad',              desc:'Evaluación de llamadas y retroalimentación.', on:false },
    { id:'ivr',        nom:'IVR',                  desc:'Menú de opciones para llamadas entrantes.',   on:false },
    { id:'grabacion',  nom:'Grabación de llamadas', desc:'Almacena el audio de cada interacción.',      on:true  },
    { id:'pantalla',   nom:'Grabación de pantalla', desc:'Registra la pantalla del agente durante la llamada.', on:false },
    { id:'whatsapp',   nom:'WhatsApp',             desc:'Canal de mensajería integrado al escritorio.', on:false },
    { id:'encuestas',  nom:'Encuestas de salida',  desc:'Encuesta de satisfacción al finalizar la llamada.', on:false },
  ];

  const GRABACIONES = [
    { id:'g1', fecha:'07/09/2026 09:14', agente:'Ana Rodríguez',  numero:'3105558812', seg:390, camp:'Ventas',   tip:'Efectiva' },
    { id:'g2', fecha:'07/09/2026 09:31', agente:'Pedro Martínez', numero:'3216674590', seg:145, camp:'Soporte',  tip:'Entró con falla' },
    { id:'g3', fecha:'07/09/2026 10:02', agente:'Ana Rodríguez',  numero:'3004432187', seg:512, camp:'Ventas',   tip:'Efectiva' },
    { id:'g4', fecha:'07/09/2026 10:20', agente:'Pedro Martínez', numero:'3187765430', seg:78,  camp:'Soporte',  tip:'Se cayó' },
    { id:'g5', fecha:'07/09/2026 10:47', agente:'Ana Rodríguez',  numero:'3012298877', seg:263, camp:'Ventas',   tip:'Efectiva' },
  ];

  let campanas = [
    { id:'c1', nombre:'Ventas',    tipo:'mixta',    cola:'ventas',    did:'6017569094',
      apertura:'08:00', cierre:'18:00', abierta:true,  formulario:'', marcacion:[{et:'Supervisora', n:'1002'}] },
    { id:'c2', nombre:'Soporte',   tipo:'entrante', cola:'soporte',   did:'6013902000',
      apertura:'07:00', cierre:'20:00', abierta:true,  formulario:'', marcacion:[] },
    { id:'c3', nombre:'Cobranza',  tipo:'saliente', cola:'cobranza',  did:'',
      apertura:'08:00', cierre:'17:00', abierta:false, formulario:'', marcacion:[] },
    { id:'c4', nombre:'Retención', tipo:'mixta',    cola:'retencion', did:'6017569095',
      apertura:'08:00', cierre:'18:00', abierta:true,  formulario:'', marcacion:[] },
  ];

  let editandoCamp = null;
  let editandoUsr = null;
  let escuchando = null;

  const $$ = (id) => document.getElementById(id);

  /* ═══════════════════════════════════════════════════════════════
     SUPERVISOR · HORARIOS Y DISTRIBUCIÓN
     ═══════════════════════════════════════════════════════════════ */

  function abrirCampanas() {
    pintarHorarios();
    pintarDistribucion();
  }

  function pintarHorarios() {
    $$('tablaHorarios').innerHTML = `<table class="tb">
      <tr><th>Campaña</th><th>Tipo</th><th>Horario</th><th>Estado</th><th></th></tr>
      ${campanas.map((c) => `<tr>
        <td><b>${c.nombre}</b></td>
        <td>${c.tipo}</td>
        <td class="mono">${c.apertura} – ${c.cierre}</td>
        <td><span class="t ${c.abierta ? 'g' : 'r'}">${c.abierta ? 'Abierta' : 'Cerrada'}</span></td>
        <td><button class="b ${c.abierta ? 'b-red' : 'b-green'} b-sm"
              data-hor="${c.id}">${c.abierta ? 'Cerrar' : 'Abrir'}</button></td>
      </tr>`).join('')}</table>`;
  }

  $$('tablaHorarios')?.addEventListener('click', (e) => {
    const b = e.target.closest('[data-hor]');
    if (!b) return;
    const c = campanas.find((x) => x.id === b.dataset.hor);
    if (!c) return;
    c.abierta = !c.abierta;
    pintarHorarios();
    aviso(c.abierta
      ? `Campaña ${c.nombre} abierta.`
      : `Campaña ${c.nombre} cerrada. Las llamadas entrantes escuchan el audio de fuera de horario.`,
      c.abierta ? 'av-b' : 'av-a');
  });

  function pintarDistribucion() {
    const agentes = servicio.usuarios.filter((u) => u.rol === 'agente');
    $$('selAgentes').innerHTML = agentes.map((a) =>
      `<option value="${a.usuario}">${a.nombre} · ${a.campana}</option>`).join('');
    $$('selDestino').innerHTML = campanas.map((c) =>
      `<option value="${c.nombre}">${c.nombre}</option>`).join('');
  }

  $$('btnMover')?.addEventListener('click', () => {
    const sel = [...$$('selAgentes').selectedOptions];
    if (!sel.length) { aviso('Selecciona al menos un agente.', 'av-a'); return; }
    const destino = $$('selDestino').value;

    sel.forEach((o) => {
      const u = servicio.usuarios.find((x) => x.usuario === o.value);
      if (u) servicio.cambiarCampana(u.usuario, destino);
    });

    pintarDistribucion();
    aviso(`${sel.length} agente(s) movido(s) a ${destino}.`, 'av-b');
  });

  /* ═══════════════════════════════════════════════════════════════
     SUPERVISOR · GRABACIONES
     ═══════════════════════════════════════════════════════════════ */

  function abrirGrabaciones() {
    const agentes = servicio.usuarios.filter((u) => u.rol === 'agente');
    $$('grabAgente').innerHTML = '<option value="">Todos</option>' +
      agentes.map((a) => `<option>${a.nombre}</option>`).join('');
    buscarGrabaciones();
  }

  function buscarGrabaciones() {
    const agente = $$('grabAgente').value;
    const numero = $$('grabNumero').value.trim();

    const lista = GRABACIONES.filter((g) =>
      (!agente || g.agente === agente) &&
      (!numero || g.numero.includes(numero)));

    $$('grabN').textContent = lista.length;

    $$('tablaGrabaciones').innerHTML = !lista.length
      ? '<div class="vacio">Ninguna grabación coincide con el filtro.</div>'
      : `<table class="tb">
        <tr><th>Fecha</th><th>Agente</th><th>Número</th><th>Campaña</th><th>Duración</th><th>Tipificación</th><th></th></tr>
        ${lista.map((g) => `<tr>
          <td class="mono">${g.fecha}</td>
          <td>${g.agente}</td>
          <td class="mono">${g.numero}</td>
          <td>${g.camp}</td>
          <td class="mono">${duracion(g.seg)}</td>
          <td>${g.tip}</td>
          <td><button class="b b-teal b-sm" data-grab="${g.id}">Escuchar</button></td>
        </tr>`).join('')}</table>`;
  }

  $$('btnBuscarGrab')?.addEventListener('click', buscarGrabaciones);

  $$('tablaGrabaciones')?.addEventListener('click', (e) => {
    const b = e.target.closest('[data-grab]');
    if (!b) return;
    const g = GRABACIONES.find((x) => x.id === b.dataset.grab);
    if (!g) return;

    $$('reproductor').style.display = '';
    $$('grabDetalle').textContent =
      `${g.agente} · ${g.numero} · ${g.fecha} · ${duracion(g.seg)}`;
    $$('grabRuta').textContent =
      `/var/spool/asterisk/monitor/${g.fecha.slice(6,10)}/${g.id}.wav`;
    aviso('Con el backend conectado, aquí suena el audio del servidor.', 'av-b');
  });

  $$('btnDescargarGrab')?.addEventListener('click', () => {
    aviso('La descarga se habilita cuando el backend exponga el archivo.', 'av-b');
  });

  /* ═══════════════════════════════════════════════════════════════
     SUPERVISOR · ESCUCHA EN LÍNEA
     ═══════════════════════════════════════════════════════════════ */

  function abrirEscucha() {
    /* En producción esto sale de los eventos del AMI. Aquí se muestra
       la llamada del propio agente si está en curso. */
    const activas = [];
    if (telefonia.estado === 'activa' || telefonia.estado === 'espera') {
      activas.push({
        agente: ui.sesion?.nombre || 'Agente',
        numero: telefonia.numero,
        campana: ui.sesion?.campana || '—',
        desde: telefonia.inicio,
      });
    }

    $$('escN').textContent = activas.length;
    $$('tablaEscucha').innerHTML = !activas.length
      ? '<div class="vacio">No hay llamadas activas en este momento.</div>'
      : `<table class="tb">
        <tr><th>Agente</th><th>Número</th><th>Campaña</th><th>Duración</th><th></th></tr>
        ${activas.map((a, i) => `<tr>
          <td><b>${a.agente}</b></td>
          <td class="mono">${a.numero}</td>
          <td>${a.campana}</td>
          <td class="mono">${duracion(Math.round((Date.now() - a.desde) / 1000))}</td>
          <td><button class="b b-dark b-sm" data-esc="${i}">Escuchar</button></td>
        </tr>`).join('')}</table>`;
  }

  $$('tablaEscucha')?.addEventListener('click', (e) => {
    const b = e.target.closest('[data-esc]');
    if (!b) return;
    escuchando = true;
    $$('escuchaActiva').style.display = '';
    $$('escDetalle').textContent =
      `${ui.sesion?.nombre || 'Agente'} · ${telefonia.numero || '—'}`;
    aviso('Escucha iniciada. El agente y el cliente no lo perciben.', 'av-b');
  });

  $$('btnDejarEscucha')?.addEventListener('click', () => {
    escuchando = null;
    $$('escuchaActiva').style.display = 'none';
    aviso('Escucha finalizada.', 'av-b');
  });

  /* ═══════════════════════════════════════════════════════════════
     SUPERADMIN · CONFIGURACIÓN DE CAMPAÑAS
     ═══════════════════════════════════════════════════════════════ */

  function abrirAdmCampanas() {
    pintarListaCampanas();
    llenarFormularios();
  }

  function pintarListaCampanas() {
    $$('listaCampanas').innerHTML = campanas.map((c) => `
      <div class="fila-camp" data-camp="${c.id}">
        <div class="bd">
          <b>${c.nombre}</b>
          <span>${c.tipo}${c.did ? ' · DID ' + c.did : ''} · cola ${c.cola}</span>
        </div>
        <span class="t ${c.abierta ? 'g' : 'o'}">${c.abierta ? 'Abierta' : 'Cerrada'}</span>
      </div>`).join('');
  }

  function llenarFormularios() {
    const fs = (typeof formularios !== 'undefined' && servicio.formularios)
      ? servicio.formularios() : [];
    $$('campForm').innerHTML = '<option value="">— Sin formulario —</option>' +
      fs.map((f) => `<option value="${f.id}">${f.nombre}</option>`).join('');
  }

  $$('listaCampanas')?.addEventListener('click', (e) => {
    const f = e.target.closest('[data-camp]');
    if (!f) return;
    const c = campanas.find((x) => x.id === f.dataset.camp);
    if (c) editarCampana(JSON.parse(JSON.stringify(c)));
  });

  $$('btnCampNueva')?.addEventListener('click', () => {
    editarCampana({ id:'c'+Date.now(), nombre:'', tipo:'entrante', cola:'', did:'',
      apertura:'08:00', cierre:'18:00', abierta:true, formulario:'', marcacion:[] });
  });

  function editarCampana(c) {
    editandoCamp = c;
    llenarFormularios();
    $$('editorCampana').style.display = '';
    $$('campTitulo').textContent = c.nombre || 'Nueva campaña';
    $$('campNombre').value = c.nombre;
    $$('campCola').value = c.cola;
    $$('campDid').value = c.did || '';
    $$('campApertura').value = c.apertura;
    $$('campCierre').value = c.cierre;
    $$('campForm').value = c.formulario || '';
    document.querySelectorAll('#campTipo .tab').forEach((t) =>
      t.classList.toggle('on', t.dataset.t === c.tipo));
    $$('campDidBox').style.display = c.tipo === 'saliente' ? 'none' : '';
    $$('btnCampBorrar').style.display = campanas.some((x) => x.id === c.id) ? '' : 'none';
    pintarMarcacion();
  }

  /* El DID solo aplica a campañas que reciben llamadas */
  $$('campTipo')?.addEventListener('click', (e) => {
    const t = e.target.closest('.tab');
    if (!t || !editandoCamp) return;
    editandoCamp.tipo = t.dataset.t;
    document.querySelectorAll('#campTipo .tab').forEach((x) => x.classList.toggle('on', x === t));
    $$('campDidBox').style.display = t.dataset.t === 'saliente' ? 'none' : '';
  });

  function pintarMarcacion() {
    const m = editandoCamp.marcacion || [];
    $$('listaMarcacion').innerHTML = !m.length
      ? '<div class="vacio">Sin contactos de marcación rápida.</div>'
      : m.map((x, i) => `
        <div class="marc" data-i="${i}">
          <input class="fi" data-k="et" value="${(x.et||'').replace(/"/g,'&quot;')}" placeholder="Etiqueta">
          <input class="fi mono" data-k="n" value="${x.n||''}" placeholder="Número">
          <button class="del" data-quitar="${i}">×</button>
        </div>`).join('');
  }

  $$('btnMarcNueva')?.addEventListener('click', () => {
    if (!editandoCamp) return;
    editandoCamp.marcacion = editandoCamp.marcacion || [];
    editandoCamp.marcacion.push({ et:'', n:'' });
    pintarMarcacion();
  });

  $$('listaMarcacion')?.addEventListener('input', (e) => {
    const fila = e.target.closest('.marc');
    if (!fila || !e.target.dataset.k) return;
    editandoCamp.marcacion[Number(fila.dataset.i)][e.target.dataset.k] = e.target.value;
  });

  $$('listaMarcacion')?.addEventListener('click', (e) => {
    const b = e.target.closest('[data-quitar]');
    if (!b) return;
    editandoCamp.marcacion.splice(Number(b.dataset.quitar), 1);
    pintarMarcacion();
  });

  $$('btnCampGuardar')?.addEventListener('click', () => {
    if (!editandoCamp) return;
    editandoCamp.nombre = $$('campNombre').value.trim();
    editandoCamp.cola = $$('campCola').value.trim();
    editandoCamp.did = $$('campDid').value.trim();
    editandoCamp.apertura = $$('campApertura').value;
    editandoCamp.cierre = $$('campCierre').value;
    editandoCamp.formulario = $$('campForm').value;

    if (!editandoCamp.nombre) { aviso('La campaña necesita un nombre.', 'av-a'); return; }
    if (!editandoCamp.cola) { aviso('Indica la cola de Asterisk.', 'av-a'); return; }
    if (editandoCamp.tipo !== 'saliente' && !editandoCamp.did) {
      aviso('Una campaña de entrada necesita un DID.', 'av-a'); return;
    }

    const i = campanas.findIndex((x) => x.id === editandoCamp.id);
    if (i >= 0) campanas[i] = editandoCamp; else campanas.push(editandoCamp);

    pintarListaCampanas();
    $$('editorCampana').style.display = 'none';
    editandoCamp = null;
    aviso('Campaña guardada.', 'av-b');
  });

  $$('btnCampCancel')?.addEventListener('click', () => {
    $$('editorCampana').style.display = 'none';
    editandoCamp = null;
  });

  $$('btnCampBorrar')?.addEventListener('click', () => {
    if (!editandoCamp) return;
    campanas = campanas.filter((x) => x.id !== editandoCamp.id);
    pintarListaCampanas();
    $$('editorCampana').style.display = 'none';
    editandoCamp = null;
    aviso('Campaña eliminada.', 'av-b');
  });

  /* ═══════════════════════════════════════════════════════════════
     SUPERADMIN · USUARIOS Y ROLES
     ═══════════════════════════════════════════════════════════════ */

  const ROL_ET = { agente:'Agente', supervisor:'Supervisor', admin:'Superadmin' };

  function abrirUsuarios() {
    $$('usrCampana').innerHTML = campanas.map((c) => `<option>${c.nombre}</option>`).join('') +
      '<option>Todas</option>';
    pintarUsuarios();
  }

  function pintarUsuarios() {
    $$('tablaUsuarios').innerHTML = `<table class="tb">
      <tr><th>Nombre</th><th>Usuario</th><th>Extensión</th><th>Campaña</th><th>Rol</th><th></th></tr>
      ${servicio.usuarios.map((u) => `<tr>
        <td><b>${u.nombre}</b></td>
        <td class="mono">${u.usuario}</td>
        <td class="mono">${u.extension || '—'}</td>
        <td>${u.campana}</td>
        <td>
          <div class="roles" data-usuario="${u.usuario}">
            ${Object.keys(ROL_ET).map((r) =>
              `<button class="rol-b ${u.rol === r ? 'on' : ''}" data-rol="${r}">${ROL_ET[r]}</button>`).join('')}
          </div>
        </td>
        <td><button class="b b-gh b-sm" data-editar="${u.usuario}">Editar</button></td>
      </tr>`).join('')}</table>`;
  }

  /* Cambio de rol de un solo clic */
  $$('tablaUsuarios')?.addEventListener('click', (e) => {
    const rb = e.target.closest('[data-rol]');
    if (rb) {
      const usuario = rb.closest('[data-usuario]').dataset.usuario;
      servicio.cambiarRol(usuario, rb.dataset.rol);
      pintarUsuarios();
      aviso(`Rol cambiado a ${ROL_ET[rb.dataset.rol]}. Se aplica al volver a iniciar sesión.`, 'av-b');
      return;
    }
    const eb = e.target.closest('[data-editar]');
    if (eb) {
      const u = servicio.usuarios.find((x) => x.usuario === eb.dataset.editar);
      if (u) editarUsuario({ ...u });
    }
  });

  $$('btnUsrNuevo')?.addEventListener('click', () => {
    editarUsuario({ usuario:'', nombre:'', rol:'agente', extension:'', campana:campanas[0]?.nombre || '' });
  });

  function editarUsuario(u) {
    editandoUsr = u;
    $$('editorUsuario').style.display = '';
    $$('usrTitulo').textContent = u.nombre || 'Nuevo usuario';
    $$('usrNombre').value = u.nombre;
    $$('usrUsuario').value = u.usuario;
    $$('usrExt').value = u.extension || '';
    $$('usrCampana').value = u.campana;
    document.querySelectorAll('#usrRol .tab').forEach((t) =>
      t.classList.toggle('on', t.dataset.t === u.rol));
  }

  $$('usrRol')?.addEventListener('click', (e) => {
    const t = e.target.closest('.tab');
    if (!t || !editandoUsr) return;
    editandoUsr.rol = t.dataset.t;
    document.querySelectorAll('#usrRol .tab').forEach((x) => x.classList.toggle('on', x === t));
  });

  $$('btnUsrGuardar')?.addEventListener('click', () => {
    if (!editandoUsr) return;
    const datos = {
      usuario: $$('usrUsuario').value.trim().toLowerCase(),
      nombre: $$('usrNombre').value.trim(),
      extension: $$('usrExt').value.trim(),
      campana: $$('usrCampana').value,
      rol: editandoUsr.rol,
    };
    if (!datos.usuario || !datos.nombre) {
      aviso('El usuario necesita nombre y nombre de usuario.', 'av-a'); return;
    }
    const r = servicio.guardarUsuario(datos);
    if (!r.ok) { aviso(r.error, 'av-a'); return; }

    pintarUsuarios();
    $$('editorUsuario').style.display = 'none';
    editandoUsr = null;
    aviso('Usuario guardado.', 'av-b');
  });

  $$('btnUsrCancel')?.addEventListener('click', () => {
    $$('editorUsuario').style.display = 'none';
    editandoUsr = null;
  });

  /* ═══════════════════════════════════════════════════════════════
     SUPERADMIN · MÓDULOS
     ═══════════════════════════════════════════════════════════════ */

  function abrirModulos() {
    $$('listaModulos').innerHTML = MODULOS.map((m) => `
      <div class="modulo">
        <div class="bd"><b>${m.nom}</b><span>${m.desc}</span></div>
        <button class="sw ${m.on ? 'on' : ''}" data-mod="${m.id}">
          <span class="sw-p"></span>
          <span class="sw-t">${m.on ? 'Activo' : 'Inactivo'}</span>
        </button>
      </div>`).join('');
  }

  $$('listaModulos')?.addEventListener('click', (e) => {
    const b = e.target.closest('[data-mod]');
    if (!b) return;
    const m = MODULOS.find((x) => x.id === b.dataset.mod);
    if (!m) return;
    m.on = !m.on;
    abrirModulos();
    aviso(`Módulo ${m.nom} ${m.on ? 'activado' : 'desactivado'}.`, 'av-b');
  });

  /* ── Utilidades ─────────────────────────────────────────────── */
  const duracion = (s) =>
    `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

  return {
    abrirCampanas, abrirGrabaciones, abrirEscucha,
    abrirAdmCampanas, abrirUsuarios, abrirModulos,
    get campanas() { return campanas.map((c) => ({ ...c })); },
    get modulos() { return MODULOS.map((m) => ({ ...m })); },
  };
})();
