/* ═══════════════════════════════════════════════════════════════════
   BPM CONSULTING — PANEL DE SUPERVISIÓN Y REPORTES

   Qué resuelve, de lo pedido en la reunión:
     · seguimiento a los agentes (estado, si tienen llamada, tiempos)
     · ver estado de campañas
     · cuántas llamadas hay y si hay llamadas en cola
     · bajar reportes
     · cerrar horarios

   Los datos salen de `servicio`. Cuando exista el backend, llegarán
   por WebSocket desde los eventos del AMI de Asterisk, y solo cambia
   de dónde se leen: las funciones de pintado quedan igual.
   ═══════════════════════════════════════════════════════════════════ */
'use strict';

const supervision = (() => {

  let intervalo = null;
  let filtro = 'Todas';
  let ultimoReporte = null;

  /* ═══════════ ARRANQUE Y PARADA ═══════════ */
  function iniciar() {
    llenarFiltro();
    llenarReportes();
    pintar();
    detener();
    intervalo = setInterval(() => {
      servicio.tictac();
      // Solo repinta si el supervisor está mirando: no gasta en vano
      const v = document.querySelector('.vista.on');
      if (v && v.dataset.v === 'supervision') pintar();
    }, 1000);
  }

  function detener() {
    if (intervalo) clearInterval(intervalo);
    intervalo = null;
  }

  /* ═══════════ INDICADORES ═══════════ */
  function pintar() {
    const v = servicio.estadoVivo();
    const ag = filtro === 'Todas' ? v.agentes : v.agentes.filter((a) => a.campana === filtro);
    const co = filtro === 'Todas' ? v.colas : v.colas.filter((c) => c.campana === filtro);

    pintarKpis(ag, co);
    pintarColas(co);
    pintarAgentes(ag);
    pintarCampanas();
  }

  function pintarKpis(agentes, colas) {
    const conectados = agentes.length;
    const enLlamada = agentes.filter((a) => a.estado === 'En llamada').length;
    const libres = agentes.filter((a) => a.estado === 'Disponible').length;
    const enPausa = agentes.filter((a) =>
      ['Baño', 'Almuerzo', 'Break', 'Retroalimentación'].includes(a.estado)).length;
    const enCola = colas.reduce((s, c) => s + c.enEspera, 0);
    const espera = Math.max(0, ...colas.map((c) => c.masVieja));
    const atendidas = colas.reduce((s, c) => s + c.atendidas, 0);
    const abandonadas = colas.reduce((s, c) => s + c.abandonadas, 0);
    const total = atendidas + abandonadas;
    const nivel = total ? Math.round((atendidas / total) * 100) : 0;

    const tarjeta = (et, vl, sb, clase = '') =>
      `<div class="kpi ${clase}"><div class="et">${et}</div>` +
      `<div class="vl">${vl}</div><div class="sb">${sb}</div></div>`;

    $('kpis').innerHTML = [
      tarjeta('En cola', enCola, enCola ? 'espera máxima ' + reloj(espera) : 'nadie esperando',
        enCola > 2 ? 'alerta' : enCola === 0 ? 'bien' : ''),
      tarjeta('En llamada', enLlamada, `de ${conectados} conectados`),
      tarjeta('Disponibles', libres, libres === 0 ? 'sin agentes libres' : 'listos para atender',
        libres === 0 ? 'alerta' : ''),
      tarjeta('En pausa', enPausa, 'baño, almuerzo o break'),
      tarjeta('Atendidas', atendidas, `${abandonadas} abandonadas`),
      tarjeta('Nivel de servicio', nivel + '%', 'atendidas sobre el total',
        nivel >= 85 ? 'bien' : nivel < 70 ? 'alerta' : ''),
    ].join('');
  }

  /* ═══════════ COLAS ═══════════ */
  function pintarColas(colas) {
    const enCola = colas.reduce((s, c) => s + c.enEspera, 0);
    $('colaTag').className = 't ' + (enCola > 2 ? 'r' : enCola ? 'a' : 'g');
    $('colaTag').textContent = enCola ? enCola + ' esperando' : 'sin espera';

    $('tablaColas').innerHTML = `<table class="tb">
      <tr><th>Campaña</th><th>En cola</th><th>Más antigua</th><th>Atendidas</th><th>Nivel</th></tr>
      ${colas.map((c) => {
        const cls = c.nivel >= 85 ? '' : c.nivel >= 70 ? 'med' : 'bajo';
        return `<tr>
          <td><b>${c.campana}</b></td>
          <td><span class="t ${c.enEspera > 2 ? 'r' : c.enEspera ? 'a' : 'g'}">${c.enEspera}</span></td>
          <td class="mono">${c.enEspera ? reloj(c.masVieja) : '—'}</td>
          <td class="mono">${c.atendidas}</td>
          <td><div style="display:flex;align-items:center;gap:7px">
            <div class="nivel"><i class="${cls}" style="width:${c.nivel}%"></i></div>
            <span class="mono" style="font-size:11px">${c.nivel}%</span></div></td>
        </tr>`;
      }).join('')}</table>`;
  }

  /* ═══════════ AGENTES ═══════════ */
  function pintarAgentes(agentes) {
    $('agentesTag').className = 't o';
    $('agentesTag').textContent = agentes.length + ' agentes';

    if (!agentes.length) {
      $('tablaAgentes').innerHTML = '<div class="vacio">Ningún agente en esta campaña.</div>';
      return;
    }

    const color = (e) => e === 'En llamada' ? 'b'
                       : e === 'Disponible' ? 'g'
                       : e === 'Cierre' ? 'b' : 'a';

    $('tablaAgentes').innerHTML = `<table class="tb">
      <tr><th>Ext.</th><th>Agente</th><th>Campaña</th><th>Estado</th><th>Tiempo</th>
          <th>Atendiendo</th><th>Llamadas</th><th>TMO</th></tr>
      ${agentes.map((a) => `<tr>
        <td class="mono">${a.ext}</td>
        <td><b>${a.nombre}</b></td>
        <td>${a.campana}</td>
        <td><span class="t ${color(a.estado)}"><span class="d"></span>${a.estado}</span></td>
        <td class="mono">${reloj(a.desde)}</td>
        <td class="mono">${a.numero || '—'}</td>
        <td class="mono">${a.llamadas}</td>
        <td class="mono">${reloj(a.tmo)}</td>
      </tr>`).join('')}</table>`;
  }

  /* ═══════════ CAMPAÑAS Y HORARIOS ═══════════ */
  function pintarCampanas() {
    const hor = servicio.horarios();
    $('tablaCampanas').innerHTML = `<table class="tb">
      <tr><th>Campaña</th><th>Horario</th><th>Días</th><th>Estado</th><th></th></tr>
      ${servicio.campanas.map((c) => {
        const h = hor.find((x) => x.campana === c.nombre) || {};
        const abierto = !!h.abierto;
        return `<tr>
          <td><b>${c.nombre}</b><br><span style="font-size:10.5px;color:var(--ink-3)">${c.tipo}</span></td>
          <td class="mono">${h.inicio || '—'} a ${h.fin || '—'}</td>
          <td>${h.dias || '—'}</td>
          <td><span class="t ${abierto ? 'g' : 'o'}">${abierto ? 'Abierto' : 'Cerrado'}</span></td>
          <td><button class="b ${abierto ? 'b-gh' : 'b-teal'} b-sm" data-hor="${h.id || ''}">
            ${abierto ? 'Cerrar' : 'Abrir'}</button></td>
        </tr>`;
      }).join('')}</table>`;
  }

  /** Abrir o cerrar el horario de una campaña. */
  function alternarHorario(id) {
    const lista = servicio.horarios();
    const h = lista.find((x) => x.id === id);
    if (!h) return null;
    h.abierto = !h.abierto;
    servicio.guardarHorarios(lista);
    pintarCampanas();
    return h;
  }

  /* ═══════════ FILTRO POR CAMPAÑA ═══════════ */
  function llenarFiltro() {
    const s = $('filtroCampana');
    s.innerHTML = '<option value="Todas">Todas las campañas</option>' +
      servicio.campanas.map((c) => `<option>${c.nombre}</option>`).join('');
    s.value = filtro;
  }

  function fijarFiltro(v) { filtro = v; pintar(); }

  /* ═══════════ REPORTES ═══════════ */
  function llenarReportes() {
    $('listaReportes').innerHTML = servicio.tiposReporte.map((r) =>
      `<button class="rep" data-rep="${r.id}"><b>${r.nombre}</b><span>${r.desc}</span></button>`).join('');
  }

  /**
   * Genera un reporte y lo pinta.
   * `extra` permite inyectar el detalle de llamadas, que vive en pantalla.js.
   */
  function generar(tipo, extra) {
    const meta = servicio.tiposReporte.find((r) => r.id === tipo);
    const datos = tipo === 'llamadas' && extra ? extra : servicio.generarReporte(tipo);
    ultimoReporte = { tipo, nombre: meta ? meta.nombre : tipo, ...datos };

    $('repResultado').style.display = '';
    $('repTitulo').textContent = ultimoReporte.nombre;
    $('repSub').textContent =
      `${datos.filas.length} fila(s) · generado ${new Date().toLocaleString('es-CO')}`;

    $('repTabla').innerHTML = !datos.filas.length
      ? '<div class="vacio">Este reporte no tiene datos todavía.</div>'
      : `<table class="tb">
          <tr>${datos.columnas.map((c) => `<th>${c}</th>`).join('')}</tr>
          ${datos.filas.slice(0, 100).map((f) =>
            `<tr>${f.map((v) => `<td class="mono">${v}</td>`).join('')}</tr>`).join('')}
        </table>` +
        (datos.filas.length > 100
          ? `<p class="hint" style="margin-top:8px">Se muestran las primeras 100 filas.
             El CSV trae las ${datos.filas.length}.</p>` : '');

    return ultimoReporte;
  }

  /** Descarga el último reporte en CSV, legible por Excel. */
  function descargarCsv() {
    if (!ultimoReporte || !ultimoReporte.filas.length) return false;

    const escapar = (v) => {
      const s = String(v ?? '');
      return /[";\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    // Punto y coma: es el separador que Excel espera en configuración es-CO
    const lineas = [ultimoReporte.columnas.map(escapar).join(';')]
      .concat(ultimoReporte.filas.map((f) => f.map(escapar).join(';')));

    // BOM para que Excel respete las tildes
    const blob = new Blob(['\uFEFF' + lineas.join('\r\n')],
      { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `bpm-${ultimoReporte.tipo}-` +
      new Date().toISOString().slice(0, 16).replace(/[:T]/g, '') + '.csv';
    a.click();
    URL.revokeObjectURL(a.href);
    return true;
  }

  /* ═══════════ UTILIDAD ═══════════ */
  const reloj = (seg) => {
    const s = Math.max(0, Math.floor(seg || 0));
    return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
  };

  return { iniciar, detener, pintar, fijarFiltro, alternarHorario,
           generar, descargarCsv, reloj };
})();
