/* ═══════════════════════════════════════════════════════════════════
   BPM CONSULTING — FORMULARIOS

   Dos caras del mismo módulo:

     LADO AGENTE      llena el formulario de su campaña. Si el servidor
                      no responde, la respuesta queda en una cola local
                      y se reintenta. Es el requisito de
                      "formularios offline".

     LADO SUPERVISOR  crea y edita formularios: nombre, campaña y campos.
                      Es el requisito de "un panel donde yo pueda crear
                      formularios".

   Los datos salen de servicio.js. Cuando exista el backend, cambia
   servicio.js y este archivo no se toca.
   ═══════════════════════════════════════════════════════════════════ */
'use strict';

const formularios = (() => {

  let formActual = null;    // formulario que está llenando el agente
  let editando = null;      // formulario abierto en el diseñador

  /* ═══════════════════════════════════════════════════════════════
     LADO AGENTE
     ═══════════════════════════════════════════════════════════════ */

  function abrirAgente() {
    const campana = ui.sesion?.campana || '—';
    $('formCampana').textContent = campana;

    const lista = servicio.formulariosDe(campana);
    $('selForm').innerHTML = '<option value="">Selecciona…</option>' +
      lista.map((f) => `<option value="${f.id}">${f.nombre}</option>`).join('');

    if (!lista.length) {
      $('formCampos').innerHTML =
        '<div class="vacio">No hay formularios activos para tu campaña.</div>';
    }

    // Si hay una llamada en curso, el número se llena solo
    if (telefonia.numero) $('formNum').value = telefonia.numero;

    pintarPendientes();
  }

  $('selForm').addEventListener('change', () => {
    const id = $('selForm').value;
    formActual = servicio.formularios().find((f) => f.id === id) || null;
    pintarCampos();
  });

  /** Dibuja los campos del formulario elegido. */
  function pintarCampos() {
    if (!formActual) {
      $('formCampos').innerHTML = '<div class="vacio">Selecciona un formulario.</div>';
      $('btnFormGuardar').style.display = 'none';
      return;
    }

    $('formCampos').innerHTML = formActual.campos.map((c, i) => {
      const req = c.requerido ? ' <i>*</i>' : '';
      const id = 'cf' + i;
      let control;

      switch (c.tipo) {
        case 'texto':
          control = `<input class="fi" id="${id}" data-campo="${c.etiqueta}" autocomplete="off">`;
          break;
        case 'numero':
          control = `<input class="fi mono" id="${id}" type="number" data-campo="${c.etiqueta}">`;
          break;
        case 'fecha':
          control = `<input class="fi" id="${id}" type="date" data-campo="${c.etiqueta}">`;
          break;
        case 'lista':
          control = `<select class="fi" id="${id}" data-campo="${c.etiqueta}">` +
            '<option value="">Selecciona…</option>' +
            (c.opciones || []).map((o) => `<option>${o}</option>`).join('') + '</select>';
          break;
        case 'si_no':
          control = `<select class="fi" id="${id}" data-campo="${c.etiqueta}">` +
            '<option value="">Selecciona…</option><option>Sí</option><option>No</option></select>';
          break;
        case 'parrafo':
          control = `<textarea class="fi" id="${id}" data-campo="${c.etiqueta}"></textarea>`;
          break;
        default:
          control = `<input class="fi" id="${id}" data-campo="${c.etiqueta}">`;
      }
      return `<div class="f"><label>${c.etiqueta}${req}</label>${control}</div>`;
    }).join('');

    $('btnFormGuardar').style.display = '';
  }

  /** Recoge lo escrito y lo encola. */
  $('btnFormGuardar').addEventListener('click', () => {
    if (!formActual) return;

    const numero = $('formNum').value.trim();
    if (!numero) { aviso('Escribe el número del contacto.', 'av-a'); return; }

    const datos = {};
    let falta = null;

    formActual.campos.forEach((c, i) => {
      const el = $('cf' + i);
      const v = el ? String(el.value).trim() : '';
      if (c.requerido && !v && !falta) falta = c.etiqueta;
      datos[c.etiqueta] = v;
    });

    if (falta) { aviso(`El campo "${falta}" es obligatorio.`, 'av-a'); return; }

    servicio.encolarRespuesta({
      formularioId: formActual.id,
      formulario: formActual.nombre,
      campana: formActual.campana,
      agente: ui.sesion?.nombre || '—',
      numero, datos,
    });

    aviso(hayServidor()
      ? 'Respuesta enviada.'
      : 'Respuesta guardada. Se envía en cuanto haya conexión con el servidor.', 'av-b');
    pintarCampos();          // limpia los campos
    $('formNum').value = '';
    pintarPendientes();
    intentarSincronizar();
  });

  /* ── La cola de pendientes ─────────────────────────────────────── */

  function pintarPendientes() {
    const lista = servicio.pendientes();
    $('pendN').textContent = lista.length;
    $('pendN').className = 't ' + (lista.length ? 'a' : 'o');

    if (!lista.length) {
      $('listaPend').innerHTML = '<div class="vacio">No hay respuestas pendientes.</div>';
      return;
    }

    $('listaPend').innerHTML = lista.map((p) => `
      <div class="pend">
        <div class="pend-h">
          <b>${p.formulario}</b>
          <span class="t ${p.intentos ? 'r' : 'a'}">${p.intentos ? 'Falló ' + p.intentos + '×' : 'Pendiente'}</span>
        </div>
        <span class="pend-m">${p.numero} · ${new Date(p.creada).toLocaleTimeString('es-CO')}</span>
      </div>`).join('');
  }

  /* El servicio lanza una excepción cuando no hay conexión. Es el caso
     normal en un formulario offline, no un error: se captura y se
     informa sin romper nada. */
  /* Hay conexión si el backend está configurado en js/config.js.
     Mientras no lo esté, las respuestas se acumulan en la cola. */
  const hayServidor = () => !!CONFIG.api;

  async function intentarSincronizar() {
    try {
      const r = await servicio.sincronizar(hayServidor());
      pintarPendientes();
      return { ...r, fallidas: 0 };
    } catch (e) {
      pintarPendientes();
      return { enviadas: 0, fallidas: servicio.pendientes().length, motivo: e.message };
    }
  }

  $('btnSincronizar').addEventListener('click', async () => {
    const b = $('btnSincronizar');
    b.disabled = true; b.textContent = 'Enviando…';
    const r = await intentarSincronizar();
    b.disabled = false; b.textContent = 'Enviar pendientes';

    if (r.enviadas) aviso(`${r.enviadas} respuesta(s) enviada(s) al servidor.`, 'av-b');
    else if (r.fallidas) aviso(r.motivo || 'Sin conexión. Las respuestas siguen guardadas.', 'av-a');
    else aviso('No había nada pendiente.', 'av-b');
  });

  /* ═══════════════════════════════════════════════════════════════
     LADO SUPERVISOR — el diseñador
     ═══════════════════════════════════════════════════════════════ */

  function abrirDisenador() {
    llenarCampanasEditor();
    pintarLista();
  }

  function llenarCampanasEditor() {
    if ($('edCampana').options.length) return;
    $('edCampana').innerHTML = '<option value="Todas">Todas las campañas</option>' +
      servicio.campanas.map((c) => `<option>${c.nombre}</option>`).join('');
  }

  function pintarLista() {
    const lista = servicio.formularios();
    if (!lista.length) {
      $('listaForms').innerHTML = '<div class="vacio">Todavía no hay formularios.</div>';
      return;
    }
    $('listaForms').innerHTML = lista.map((f) => `
      <div class="fila-form" data-id="${f.id}">
        <div class="bd">
          <b>${f.nombre}</b>
          <span>${f.campana} · ${f.campos.length} campo(s)</span>
        </div>
        <span class="t ${f.activo ? 'g' : 'o'}">${f.activo ? 'Activo' : 'Inactivo'}</span>
      </div>`).join('');
  }

  $('listaForms').addEventListener('click', (e) => {
    const fila = e.target.closest('.fila-form');
    if (!fila) return;
    const f = servicio.formularios().find((x) => x.id === fila.dataset.id);
    if (f) editar(JSON.parse(JSON.stringify(f)));
  });

  $('btnFormNuevo').addEventListener('click', () => {
    editar({ id: 'f' + Date.now(), nombre: '', campana: 'Todas', activo: true, campos: [] });
  });

  function editar(f) {
    editando = f;
    llenarCampanasEditor();
    $('editorForm').style.display = '';
    $('edTitulo').textContent = f.nombre || 'Nuevo formulario';
    $('edNombre').value = f.nombre;
    $('edCampana').value = f.campana;
    $('edActivo').checked = f.activo;
    $('btnFormBorrar').style.display = servicio.formularios().some((x) => x.id === f.id) ? '' : 'none';
    pintarCamposEditor();
  }

  /** Los campos del formulario en edición, con sus controles. */
  function pintarCamposEditor() {
    if (!editando.campos.length) {
      $('edCampos').innerHTML = '<div class="vacio">Sin campos. Añade el primero.</div>';
      return;
    }
    const tipos = servicio.tiposCampo;

    $('edCampos').innerHTML = editando.campos.map((c, i) => `
      <div class="campo" data-i="${i}">
        <div class="campo-h">
          <span class="campo-n">${i + 1}</span>
          <input class="fi campo-et" data-k="etiqueta" value="${(c.etiqueta || '').replace(/"/g, '&quot;')}" placeholder="Nombre del campo">
          <select class="fi campo-tp" data-k="tipo">
            ${tipos.map((t) => `<option value="${t.id}"${t.id === c.tipo ? ' selected' : ''}>${t.et}</option>`).join('')}
          </select>
          <button class="campo-b" data-a="subir"  title="Subir">↑</button>
          <button class="campo-b" data-a="bajar"  title="Bajar">↓</button>
          <button class="campo-b del" data-a="quitar" title="Quitar">×</button>
        </div>
        <div class="campo-f">
          <label class="chk"><input type="checkbox" data-k="requerido"${c.requerido ? ' checked' : ''}> Obligatorio</label>
          ${c.tipo === 'lista'
            ? `<input class="fi campo-op" data-k="opciones" value="${(c.opciones || []).join(', ')}" placeholder="Opciones separadas por coma">`
            : ''}
        </div>
      </div>`).join('');
  }

  /* Un solo oyente para todos los campos: lee data-i y data-k */
  $('edCampos').addEventListener('input', (e) => {
    const fila = e.target.closest('.campo');
    if (!fila) return;
    const i = Number(fila.dataset.i);
    const k = e.target.dataset.k;
    if (!k) return;

    if (k === 'requerido') editando.campos[i].requerido = e.target.checked;
    else if (k === 'opciones') {
      editando.campos[i].opciones = e.target.value.split(',').map((x) => x.trim()).filter(Boolean);
    } else editando.campos[i][k] = e.target.value;

    // Cambiar a tipo lista hace aparecer el campo de opciones
    if (k === 'tipo') pintarCamposEditor();
  });

  $('edCampos').addEventListener('change', (e) => {
    if (e.target.dataset.k === 'requerido') {
      const fila = e.target.closest('.campo');
      editando.campos[Number(fila.dataset.i)].requerido = e.target.checked;
    }
  });

  $('edCampos').addEventListener('click', (e) => {
    const b = e.target.closest('.campo-b');
    if (!b) return;
    const i = Number(b.closest('.campo').dataset.i);
    const cs = editando.campos;

    if (b.dataset.a === 'quitar') cs.splice(i, 1);
    if (b.dataset.a === 'subir' && i > 0) [cs[i - 1], cs[i]] = [cs[i], cs[i - 1]];
    if (b.dataset.a === 'bajar' && i < cs.length - 1) [cs[i + 1], cs[i]] = [cs[i], cs[i + 1]];

    pintarCamposEditor();
  });

  $('btnCampoNuevo').addEventListener('click', () => {
    editando.campos.push({ etiqueta: '', tipo: 'texto', requerido: false });
    pintarCamposEditor();
  });

  $('btnFormSave').addEventListener('click', () => {
    editando.nombre = $('edNombre').value.trim();
    editando.campana = $('edCampana').value;
    editando.activo = $('edActivo').checked;

    if (!editando.nombre) { aviso('El formulario necesita un nombre.', 'av-a'); return; }
    if (!editando.campos.length) { aviso('Añade al menos un campo.', 'av-a'); return; }
    const sinEtiqueta = editando.campos.findIndex((c) => !String(c.etiqueta).trim());
    if (sinEtiqueta >= 0) {
      aviso(`El campo ${sinEtiqueta + 1} no tiene nombre.`, 'av-a'); return;
    }

    const lista = servicio.formularios();
    const i = lista.findIndex((f) => f.id === editando.id);
    if (i >= 0) lista[i] = editando; else lista.push(editando);

    servicio.guardarFormularios(lista);
    pintarLista();
    $('editorForm').style.display = 'none';
    editando = null;
    aviso('Formulario guardado. El agente lo ve al recargar su pantalla.', 'av-b');
  });

  $('btnFormCancel').addEventListener('click', () => {
    $('editorForm').style.display = 'none';
    editando = null;
  });

  $('btnFormBorrar').addEventListener('click', () => {
    if (!editando) return;
    servicio.guardarFormularios(servicio.formularios().filter((f) => f.id !== editando.id));
    pintarLista();
    $('editorForm').style.display = 'none';
    editando = null;
    aviso('Formulario eliminado.', 'av-b');
  });

  return { abrirAgente, abrirDisenador, pintarPendientes };
})();
