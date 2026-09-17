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

  /* Se cargan del backend al abrir cada vista */
  let campanas = [];

  let editandoCamp = null;
  let editandoUsr = null;
  let escuchando = null;

  const $$ = (id) => document.getElementById(id);

  /* ═══════════════════════════════════════════════════════════════
     SUPERVISOR · HORARIOS Y DISTRIBUCIÓN
     ═══════════════════════════════════════════════════════════════ */

  async function abrirCampanas() {
    campanas = await servicio.listarCampanas();
    pintarHorarios();
    await pintarDistribucion();
  }

  function pintarHorarios() {
    $$('tablaHorarios').innerHTML = `<table class="tb">
      <tr><th>Campaña</th><th>Tipo</th><th>Horario</th><th>Estado</th><th></th></tr>
      ${campanas.map((c) => `<tr>
        <td><b>${c.nombre}</b></td>
        <td>${c.tipo}</td>
        <td class="mono">${(c.hora_apertura||'').slice(0,5)} – ${(c.hora_cierre||'').slice(0,5)}</td>
        <td><span class="t ${c.abierta ? 'g' : 'r'}">${c.abierta ? 'Abierta' : 'Cerrada'}</span></td>
        <td><button class="b ${c.abierta ? 'b-red' : 'b-green'} b-sm"
              data-hor="${c.id}">${c.abierta ? 'Cerrar' : 'Abrir'}</button></td>
      </tr>`).join('')}</table>`;
  }

  $$('tablaHorarios')?.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-hor]');
    if (!b) return;
    const c = campanas.find((x) => String(x.id) === b.dataset.hor);
    if (!c) return;

    const r = await servicio.alternarHorario(c.id);
    if (!r.ok) { aviso(r.error, 'av-a'); return; }

    c.abierta = r.abierta;
    pintarHorarios();
    aviso(c.abierta
      ? `Campaña ${c.nombre} abierta.`
      : `Campaña ${c.nombre} cerrada. Las llamadas entrantes escuchan el audio de fuera de horario.`,
      c.abierta ? 'av-b' : 'av-a');
  });

  async function pintarDistribucion() {
    const todos = await servicio.listarUsuarios();
    const agentes = todos.filter((u) => u.rol === 'agente' && u.activo !== false);

    $$('selAgentes').innerHTML = agentes.map((a) =>
      `<option value="${a.id ?? a.usuario}" data-usuario="${a.usuario}">${a.nombre} · ${a.campana || 'sin campaña'}</option>`).join('');
    $$('selDestino').innerHTML = campanas.map((c) =>
      `<option value="${c.id}">${c.nombre}</option>`).join('');
  }

  $$('btnMover')?.addEventListener('click', async () => {
    const sel = [...$$('selAgentes').selectedOptions];
    if (!sel.length) { aviso('Selecciona al menos un agente.', 'av-a'); return; }

    const campanaId = Number($$('selDestino').value);
    const destino = $$('selDestino').selectedOptions[0]?.textContent || '';

    let ok = 0;
    for (const o of sel) {
      const r = await servicio.cambiarCampanaRemoto(
        Number(o.value) || null, o.dataset.usuario, campanaId, destino);
      if (r.ok) ok++;
    }

    await pintarDistribucion();
    aviso(ok === sel.length
      ? `${ok} agente(s) movido(s) a ${destino}.`
      : `Se movieron ${ok} de ${sel.length}. Revisa los que fallaron.`,
      ok === sel.length ? 'av-b' : 'av-a');
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

  async function abrirAdmCampanas() {
    await recargarCampanas();
    await llenarFormularios();
  }

  async function recargarCampanas() {
    $$('listaCampanas').innerHTML = '<div class="vacio">Cargando…</div>';
    try {
      campanas = await servicio.listarCampanas();
    } catch (e) {
      $$('listaCampanas').innerHTML =
        `<div class="aviso av-r" style="margin:0"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg><div>No se pudieron cargar: ${e.message}</div></div>`;
      return;
    }
    pintarListaCampanas();
  }

  function pintarListaCampanas() {
    if (!campanas.length) {
      $$('listaCampanas').innerHTML = '<div class="vacio">No hay campañas registradas.</div>';
      return;
    }
    $$('listaCampanas').innerHTML = campanas.map((c) => `
      <div class="fila-camp" data-camp="${c.id}">
        <div class="bd">
          <b>${c.nombre}</b>
          <span>${c.tipo}${c.did ? ' · DID ' + c.did : ''} · cola ${c.cola_asterisk || '—'}</span>
        </div>
        <span class="t ${c.abierta ? 'g' : 'o'}">${c.abierta ? 'Abierta' : 'Cerrada'}</span>
      </div>`).join('');
  }

  async function llenarFormularios() {
    let fs = [];
    try { fs = servicio.formularios ? servicio.formularios() : []; } catch {}
    $$('campForm').innerHTML = '<option value="">— Sin formulario —</option>' +
      fs.map((f) => `<option value="${f.id}">${f.nombre}</option>`).join('');
  }

  $$('listaCampanas')?.addEventListener('click', (e) => {
    const f = e.target.closest('[data-camp]');
    if (!f) return;
    const c = campanas.find((x) => String(x.id) === f.dataset.camp);
    if (c) editarCampana({ ...c });
  });

  $$('btnCampNueva')?.addEventListener('click', () => {
    editarCampana({ nombre:'', tipo:'entrante', cola_asterisk:'', did:'',
      hora_apertura:'08:00', hora_cierre:'18:00', acw_segundos:60, marcacion:[] });
  });

  function editarCampana(c) {
    editandoCamp = c;
    $$('editorCampana').style.display = '';
    $$('campTitulo').textContent = c.nombre || 'Nueva campaña';
    $$('campNombre').value = c.nombre || '';
    $$('campCola').value = c.cola_asterisk || '';
    $$('campDid').value = c.did || '';
    $$('campApertura').value = (c.hora_apertura || '08:00').slice(0, 5);
    $$('campCierre').value = (c.hora_cierre || '18:00').slice(0, 5);
    $$('campForm').value = c.formulario_id || '';
    $$('campCola').disabled = !!c.id;      // la cola no se renombra

    c.tipo = c.tipo || 'entrante';
    document.querySelectorAll('#campTipo .tab').forEach((t) =>
      t.classList.toggle('on', t.dataset.t === c.tipo));
    $$('campDidBox').style.display = c.tipo === 'saliente' ? 'none' : '';
    $$('btnCampBorrar').style.display = c.id ? '' : 'none';

    c.marcacion = c.marcacion || [];
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
    const m = editandoCamp?.marcacion || [];
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

  $$('btnCampGuardar')?.addEventListener('click', async () => {
    if (!editandoCamp) return;

    const datos = {
      id: editandoCamp.id,
      nombre: $$('campNombre').value.trim(),
      tipo: editandoCamp.tipo,
      cola_asterisk: $$('campCola').value.trim(),
      did: $$('campDid').value.trim(),
      formulario_id: Number($$('campForm').value) || null,
      hora_apertura: $$('campApertura').value + ':00',
      hora_cierre: $$('campCierre').value + ':00',
      acw_segundos: 60,
    };

    if (!datos.nombre) { aviso('La campaña necesita un nombre.', 'av-a'); return; }
    if (!datos.cola_asterisk) { aviso('Indica la cola de Asterisk.', 'av-a'); return; }
    if (!/^[a-z0-9_-]+$/i.test(datos.cola_asterisk)) {
      aviso('La cola solo admite letras, números, guion y guion bajo.', 'av-a'); return;
    }
    if (datos.tipo !== 'saliente' && !datos.did) {
      aviso('Una campaña de entrada necesita un DID.', 'av-a'); return;
    }

    const btn = $$('btnCampGuardar');
    btn.disabled = true; btn.textContent = 'Guardando…';
    const r = await servicio.guardarCampana(datos);
    btn.disabled = false; btn.textContent = 'Guardar';

    if (!r.ok) { aviso(r.error, 'av-a'); return; }

    await recargarCampanas();
    $$('editorCampana').style.display = 'none';
    editandoCamp = null;

    if (r.actualizada) { aviso('Campaña actualizada.', 'av-b'); return; }

    let msg = 'Campaña creada.';
    if (r.colaCreada === false) {
      msg += ` La cola <b>${datos.cola_asterisk}</b> debe crearse manualmente en la central.`;
    } else {
      msg += ` Su cola <b>${datos.cola_asterisk}</b> quedó creada en la central.`;
    }
    aviso(msg, 'av-b');
  });

  $$('btnCampCancel')?.addEventListener('click', () => {
    $$('editorCampana').style.display = 'none';
    editandoCamp = null;
  });

  $$('btnCampBorrar')?.addEventListener('click', async () => {
    if (!editandoCamp?.id) return;
    if (!confirm(`¿Desactivar la campaña ${editandoCamp.nombre}?\n\n` +
                 'No se elimina: sus llamadas se conservan para los reportes.')) return;

    const r = await servicio.eliminarCampana(editandoCamp.id);
    if (!r.ok) { aviso(r.error, 'av-a'); return; }

    await recargarCampanas();
    $$('editorCampana').style.display = 'none';
    editandoCamp = null;
    aviso('Campaña desactivada.', 'av-b');
  });

  /* ═══════════════════════════════════════════════════════════════
     SUPERADMIN · USUARIOS Y ROLES
     ═══════════════════════════════════════════════════════════════ */

  const ROL_ET = { agente:'Agente', supervisor:'Supervisor', admin:'Superadmin' };

  let usuarios = [];        // lo que se está mostrando

  async function abrirUsuarios() {
    const cs = await servicio.listarCampanas();
    $$('usrCampana').innerHTML = cs.map((c) =>
      `<option value="${c.id ?? ''}">${c.nombre}</option>`).join('');
    await recargarUsuarios();
  }

  async function recargarUsuarios() {
    $$('tablaUsuarios').innerHTML = '<div class="vacio">Cargando…</div>';
    try {
      usuarios = await servicio.listarUsuarios();
    } catch (e) {
      $$('tablaUsuarios').innerHTML =
        `<div class="aviso av-r" style="margin:0"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg><div>No se pudo cargar la lista: ${e.message}</div></div>`;
      return;
    }
    pintarUsuarios();
  }

  function pintarUsuarios() {
    if (!usuarios.length) {
      $$('tablaUsuarios').innerHTML = '<div class="vacio">No hay usuarios registrados.</div>';
      return;
    }
    $$('tablaUsuarios').innerHTML = `<table class="tb">
      <tr><th>Nombre</th><th>Usuario</th><th>Extensión</th><th>Campaña</th><th>Rol</th><th></th></tr>
      ${usuarios.map((u) => `<tr${u.activo === false ? ' style="opacity:.5"' : ''}>
        <td><b>${u.nombre}</b>${u.activo === false ? ' <span class="t o">Inactivo</span>' : ''}</td>
        <td class="mono">${u.usuario}</td>
        <td class="mono">${u.extension || '—'}</td>
        <td>${u.campana || '—'}</td>
        <td>
          <div class="roles" data-usuario="${u.usuario}" data-id="${u.id ?? ''}">
            ${Object.keys(ROL_ET).map((r) =>
              `<button class="rol-b ${u.rol === r ? 'on' : ''}" data-rol="${r}">${ROL_ET[r]}</button>`).join('')}
          </div>
        </td>
        <td style="white-space:nowrap">
          <button class="b b-gh b-sm" data-editar="${u.usuario}">Editar</button>
          <button class="b b-gh b-sm" data-rest="${u.id ?? ''}" title="Devolver a la contraseña temporal">Restablecer</button>
        </td>
      </tr>`).join('')}</table>`;
  }

  $$('tablaUsuarios')?.addEventListener('click', async (e) => {
    /* Cambio de rol de un solo clic */
    const rb = e.target.closest('[data-rol]');
    if (rb) {
      const caja = rb.closest('[data-usuario]');
      const r = await servicio.cambiarRolRemoto(
        Number(caja.dataset.id) || null, caja.dataset.usuario, rb.dataset.rol);
      if (!r.ok) { aviso(r.error, 'av-a'); return; }
      await recargarUsuarios();
      aviso(`Rol cambiado a ${ROL_ET[rb.dataset.rol]}. Se aplica al volver a iniciar sesión.`, 'av-b');
      return;
    }

    /* Restablecer contraseña */
    const rest = e.target.closest('[data-rest]');
    if (rest) {
      const u = usuarios.find((x) => String(x.id) === rest.dataset.rest);
      if (!confirm(`¿Restablecer la contraseña de ${u?.nombre || 'este usuario'}?\n\n` +
                   'Volverá a la contraseña temporal y se le exigirá cambiarla al entrar.')) return;
      const r = await servicio.restablecerClave(rest.dataset.rest);
      if (!r.ok) { aviso(r.error, 'av-a'); return; }
      aviso(`Contraseña restablecida. Entrégale: ${r.claveTemporal}`, 'av-b');
      return;
    }

    /* Editar */
    const eb = e.target.closest('[data-editar]');
    if (eb) {
      const u = usuarios.find((x) => x.usuario === eb.dataset.editar);
      if (u) editarUsuario({ ...u });
    }
  });

  $$('btnUsrNuevo')?.addEventListener('click', () => {
    editarUsuario({ usuario:'', nombre:'', rol:'agente', extension:'', campana_id:null });
  });

  function editarUsuario(u) {
    editandoUsr = u;
    $$('editorUsuario').style.display = '';
    $$('usrTitulo').textContent = u.nombre || 'Nuevo usuario';
    $$('usrNombre').value = u.nombre || '';
    $$('usrUsuario').value = u.usuario || '';
    $$('usrUsuario').disabled = !!u.id;       // el usuario no se renombra
    $$('usrExt').value = u.extension || '';
    if (u.campana_id != null) $$('usrCampana').value = String(u.campana_id);
    document.querySelectorAll('#usrRol .tab').forEach((t) =>
      t.classList.toggle('on', t.dataset.t === u.rol));

    /* Al crear, se avisa qué contraseña se le entregará */
    const nota = $$('usrNotaClave');
    if (nota) nota.style.display = u.id ? 'none' : '';
  }

  $$('usrRol')?.addEventListener('click', (e) => {
    const t = e.target.closest('.tab');
    if (!t || !editandoUsr) return;
    editandoUsr.rol = t.dataset.t;
    document.querySelectorAll('#usrRol .tab').forEach((x) => x.classList.toggle('on', x === t));
  });

  $$('btnUsrGuardar')?.addEventListener('click', async () => {
    if (!editandoUsr) return;

    const datos = {
      id: editandoUsr.id,
      usuario: $$('usrUsuario').value.trim().toLowerCase(),
      nombre: $$('usrNombre').value.trim(),
      extension: $$('usrExt').value.trim(),
      campana_id: Number($$('usrCampana').value) || null,
      campana: $$('usrCampana').selectedOptions[0]?.textContent || '',
      rol: editandoUsr.rol,
    };

    if (!datos.usuario || !datos.nombre) {
      aviso('El usuario necesita nombre y nombre de usuario.', 'av-a'); return;
    }
    if (datos.extension && !/^\d{3,6}$/.test(datos.extension)) {
      aviso('La extensión debe ser un número de 3 a 6 dígitos.', 'av-a'); return;
    }

    const btn = $$('btnUsrGuardar');
    btn.disabled = true; btn.textContent = 'Guardando…';

    const r = await servicio.guardarUsuarioRemoto(datos);

    btn.disabled = false; btn.textContent = 'Guardar';
    if (!r.ok) { aviso(r.error, 'av-a'); return; }

    await recargarUsuarios();
    $$('editorUsuario').style.display = 'none';
    editandoUsr = null;

    if (r.actualizado) {
      aviso('Usuario actualizado.', 'av-b');
    } else {
      /* Al crear se informa la contraseña temporal y el estado de la
         extensión en la central. */
      let msg = `Usuario creado. Entrégale la contraseña temporal: <b>${CLAVE_TEMPORAL}</b>. ` +
                'Se le pedirá cambiarla al entrar.';
      if (r.extensionCreada === false && datos.extension) {
        msg += `<br><br>La extensión <b>${datos.extension}</b> debe crearse manualmente ` +
               'en la central telefónica.';
      }
      aviso(msg, 'av-b');
    }
  });

  $$('btnUsrCancel')?.addEventListener('click', () => {
    $$('editorUsuario').style.display = 'none';
    editandoUsr = null;
  });

  /* La contraseña temporal la define el backend. Este valor es solo
     informativo para el mensaje que ve el administrador. */
  const CLAVE_TEMPORAL = 'BpmTemp2026#';

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