/* ═══════════════════════════════════════════════════════════════════
   BPM CONSULTING — SERVICIO DE PLATAFORMA (SIMULADO)

   Este archivo representa al BACKEND que todavía no existe.

   ---------------------------------------------------------------------
   CONTRATO CON EL BACKEND REAL

     POST   /api/sesion            { usuario, clave }
       → { id, nombre, rol, campana, extension, permisos }
     POST   /api/sip/credencial    (con el token de sesión)
       → { wss, dominio, extension, clave, ice, venceEn }
     GET    /api/campanas          → estado de cada campaña
     GET    /api/agentes           → agentes conectados y su estado
     GET    /api/colas             → llamadas en espera
     GET    /api/formularios       → definiciones por campaña
     POST   /api/formularios       → crear o modificar
     POST   /api/respuestas        → envío de formularios diligenciados
     GET    /api/reportes/:tipo    → datos para descargar

   Los datos EN VIVO (campañas, agentes, colas) vendrán de los eventos
   del AMI de Asterisk, no de consultas repetidas. Ver Sección 8 del
   manual de integración.
   ═══════════════════════════════════════════════════════════════════ */
'use strict';


/* ═══════════════════════ DATOS DE NEGOCIO ═══════════════════════
   Se reemplazan por consultas al backend cuando esté conectado.
   ═══════════════════════════════════════════════════════════════ */

/* Ficha de contacto: los campos que pidió la operación.
   nom      nombre          doc  documento
   cor      correo          tel2 teléfono secundario
   desc     descripción     hist gestiones anteriores               */
const DIRECTORIO = [
  { n:'3105558812', nom:'María Fernanda Gómez', tipoDoc:'CC', doc:'52.984.112',
    cor:'mf.gomez@correo.com', tel2:'601 742 1180', ciu:'Bogotá',
    desc:'Cliente Plan Hogar 200MB. Solicita ampliación de canales.',
    hist:[{f:'02/09/2026', a:'Ana Rodríguez', r:'Efectiva', o:'Aceptó upgrade a 400MB'},
          {f:'18/08/2026', a:'Pedro Martínez', r:'Volver a llamar', o:'Pidió llamar en la tarde'}] },

  { n:'3216674590', nom:'Carlos Andrés Ruiz', tipoDoc:'CC', doc:'80.112.443',
    cor:'caruiz@correo.com', tel2:'604 311 5522', ciu:'Medellín',
    desc:'Plan Móvil 20GB. Mora de 12 días. Acuerdo de pago vigente.',
    hist:[{f:'29/08/2026', a:'Ana Rodríguez', r:'Efectiva', o:'Acuerdo de pago a 3 cuotas'}] },

  { n:'3004432187', nom:'Luisa Fernanda Pardo', tipoDoc:'CC', doc:'1.020.554',
    cor:'lf.pardo@correo.com', tel2:'602 889 4410', ciu:'Cali',
    desc:'Plan Full TV. Sin novedades.', hist:[] },

  { n:'3159982204', nom:'Jorge Enrique Salazar', tipoDoc:'CC', doc:'79.554.221',
    cor:'je.salazar@correo.com', tel2:'605 220 7781', ciu:'Barranquilla',
    desc:'Plan Hogar 100MB. Primer contacto.', hist:[] },

  { n:'3187765430', nom:'Diana Carolina Mesa', tipoDoc:'CC', doc:'1.098.223',
    cor:'dc.mesa@correo.com', tel2:'607 645 3390', ciu:'Bucaramanga',
    desc:'Plan Móvil 8GB. Reporta intermitencia en el servicio.',
    hist:[{f:'05/09/2026', a:'Pedro Martínez', r:'Entró con falla', o:'Se cortó la comunicación'}] },

  { n:'3012298877', nom:'Andrés Felipe Torres', tipoDoc:'CC', doc:'94.335.112',
    cor:'af.torres@correo.com', tel2:'606 335 1120', ciu:'Pereira',
    desc:'Plan Full TV. Cliente desde 2021.', hist:[] },

  { n:'1001', nom:'Ana Rodríguez (Agente)', tipoDoc:'Interno', doc:'—', cor:'ana@bpm.com',
    tel2:'—', ciu:'Sede Norte', desc:'Extensión interna.', hist:[] },
  { n:'1002', nom:'Pedro Martínez (Agente)', tipoDoc:'Interno', doc:'—', cor:'pedro@bpm.com',
    tel2:'—', ciu:'Sede Norte', desc:'Extensión interna.', hist:[] },
];

/* Tipificación base definida por la operación. */
const CATALOGO = {
  'Efectiva':         ['Venta cerrada', 'Información entregada', 'Gestión completada'],
  'Se cayó':          ['Corte de línea', 'El cliente colgó'],
  'Entró muda':       [],
  'Entró con falla':  ['Sin audio', 'Audio entrecortado', 'Eco'],
  'Prueba técnica':   [],
};

/* Marcación rápida por campaña: el agente los invoca desde el
   softphone sin digitar, para evitar errores en marcaciones
   repetitivas.                                                      */
const MARCACION_RAPIDA = {
  'Ventas':   [{ et:'Supervisora', n:'1002' }, { et:'Mesa de ayuda', n:'1001' }],
  'Soporte':  [{ et:'Nivel 2', n:'1001' }, { et:'Supervisora', n:'1002' }],
  'Cobranza': [{ et:'Jurídica', n:'1001' }],
  'Todas':    [{ et:'Prueba de eco', n:'9999' }],
};

const servicio = (() => {

  /* ═════════════════════════════════════════════════════════════════
     USUARIOS · en producción: tabla `usuario`
     Cada persona YA trae su extensión — requisito de la reunión:
     "la persona debe ser equivalente a la extensión que se crea".
     ═════════════════════════════════════════════════════════════════ */
  const USUARIOS = [
    { usuario: 'ana',    nombre: 'Ana Rodríguez',  rol: 'agente',
      extension: '4021', campana: 'Ventas',   activo: true },
    { usuario: 'pedro',  nombre: 'Pedro Martínez', rol: 'agente',
      extension: '4022', campana: 'Soporte',  activo: true },
    { usuario: 'lucia',  nombre: 'Lucía Herrera',  rol: 'agente',
      extension: '4023', campana: 'Cobranza', activo: true },
    { usuario: 'sandra', nombre: 'Sandra López',   rol: 'supervisor',
      extension: '4100', campana: 'Ventas',   activo: true },
    { usuario: 'admin',  nombre: 'Jorge Betancur', rol: 'admin',
      extension: '4001', campana: 'Todas',    activo: true },
  ];

  /* ═════════════════════════════════════════════════════════════════
     CAMPAÑAS Y COLAS
     Cada campaña se corresponde con una cola de Asterisk. Ese vínculo
     decide qué catálogo ve el agente y en qué panel aparece la llamada.
     La extensión de la cola es a donde se transfiere.
     ═════════════════════════════════════════════════════════════════ */
  const CAMPANAS = [
    { id: 'ventas',    nombre: 'Ventas',    cola: 'ventas',    ext: '8001',
      tipo: 'Saliente', activa: true,  meta: 40 },
    { id: 'soporte',   nombre: 'Soporte',   cola: 'soporte',   ext: '8002',
      tipo: 'Entrante', activa: true,  meta: 60 },
    { id: 'cobranza',  nombre: 'Cobranza',  cola: 'cobranza',  ext: '8003',
      tipo: 'Saliente', activa: true,  meta: 35 },
    { id: 'retencion', nombre: 'Retención', cola: 'retencion', ext: '8004',
      tipo: 'Mixta',    activa: false, meta: 25 },
  ];

  /* ═════════════════════════════════════════════════════════════════
     ESTADO EN VIVO (simulado)
     En producción llega por WebSocket desde el backend, que a su vez
     lo recibe del AMI de Asterisk.
     ═════════════════════════════════════════════════════════════════ */
  const ESTADOS_AGENTE = ['Disponible', 'En llamada', 'Cierre', 'Baño',
                          'Almuerzo', 'Break', 'Retroalimentación'];

  const vivo = {
    agentes: [
      { ext: '4021', nombre: 'Ana Rodríguez',    campana: 'Ventas',   estado: 'En llamada', desde: 0, llamadas: 14, tmo: 214, numero: '3105558812' },
      { ext: '4022', nombre: 'Pedro Martínez',   campana: 'Soporte',  estado: 'Disponible', desde: 0, llamadas: 22, tmo: 168, numero: null },
      { ext: '4023', nombre: 'Lucía Herrera',    campana: 'Cobranza', estado: 'Almuerzo',   desde: 0, llamadas: 9,  tmo: 305, numero: null },
      { ext: '4024', nombre: 'Camilo Duarte',    campana: 'Ventas',   estado: 'Disponible', desde: 0, llamadas: 18, tmo: 191, numero: null },
      { ext: '4025', nombre: 'Natalia Ospina',   campana: 'Soporte',  estado: 'En llamada', desde: 0, llamadas: 27, tmo: 152, numero: '3216674590' },
      { ext: '4026', nombre: 'Julián Restrepo',  campana: 'Cobranza', estado: 'Cierre',     desde: 0, llamadas: 11, tmo: 260, numero: null },
      { ext: '4027', nombre: 'Paola Giraldo',    campana: 'Ventas',   estado: 'Baño',       desde: 0, llamadas: 16, tmo: 203, numero: null },
      { ext: '4028', nombre: 'Andrés Cifuentes', campana: 'Soporte',  estado: 'Disponible', desde: 0, llamadas: 20, tmo: 175, numero: null },
    ],
    colas: [
      { campana: 'Ventas',    enEspera: 0, masVieja: 0,  atendidas: 132, abandonadas: 7,  nivel: 88 },
      { campana: 'Soporte',   enEspera: 3, masVieja: 74, atendidas: 210, abandonadas: 14, nivel: 79 },
      { campana: 'Cobranza',  enEspera: 1, masVieja: 22, atendidas: 96,  abandonadas: 5,  nivel: 91 },
      { campana: 'Retención', enEspera: 0, masVieja: 0,  atendidas: 0,   abandonadas: 0,  nivel: 0 },
    ],
  };

  vivo.agentes.forEach((a) => { a.desde = Math.floor(Math.random() * 600); });

  /** Avanza la simulación un segundo. pantalla.js la llama con un intervalo. */
  function tictac() {
    vivo.agentes.forEach((a) => {
      a.desde++;
      if (Math.random() < 0.012) {
        const previo = a.estado;
        a.estado = ESTADOS_AGENTE[Math.floor(Math.random() * ESTADOS_AGENTE.length)];
        if (a.estado !== previo) a.desde = 0;
        a.numero = a.estado === 'En llamada'
          ? '3' + String(Math.floor(Math.random() * 1e9)).padStart(9, '0') : null;
        if (previo === 'En llamada') a.llamadas++;
      }
    });
    vivo.colas.forEach((c) => {
      const camp = CAMPANAS.find((x) => x.nombre === c.campana);
      if (!camp || !camp.activa) return;
      if (c.enEspera > 0) c.masVieja++;
      if (Math.random() < 0.06) c.enEspera++;
      if (c.enEspera > 0 && Math.random() < 0.09) {
        c.enEspera--; c.atendidas++;
        if (c.enEspera === 0) c.masVieja = 0;
      }
      if (c.enEspera > 0 && c.masVieja > 120 && Math.random() < 0.05) {
        c.enEspera--; c.abandonadas++;
        if (c.enEspera === 0) c.masVieja = 0;
      }
      const total = c.atendidas + c.abandonadas;
      c.nivel = total ? Math.round((c.atendidas / total) * 100) : 0;
    });
  }

  const estadoVivo = () => ({
    agentes: vivo.agentes.map((a) => ({ ...a })),
    colas: vivo.colas.map((c) => ({ ...c })),
  });

  /* ═════════════════════════════════════════════════════════════════
     FORMULARIOS · tablas `formulario` y `formulario_campo`
     El administrador y el supervisor los crean; el agente los llena.
     ═════════════════════════════════════════════════════════════════ */
  const CLAVE_FORMS = 'bpm.formularios';

  const FORMULARIOS_BASE = [
    {
      id: 'f1', nombre: 'Encuesta de satisfacción', campana: 'Soporte', activo: true,
      campos: [
        { id: 'c1', etiqueta: '¿Se resolvió su solicitud?', tipo: 'opcion',
          obligatorio: true, opciones: ['Sí', 'No', 'Parcialmente'] },
        { id: 'c2', etiqueta: 'Calificación de 1 a 5', tipo: 'numero', obligatorio: true, opciones: [] },
        { id: 'c3', etiqueta: 'Comentarios', tipo: 'texto_largo', obligatorio: false, opciones: [] },
      ],
    },
    {
      id: 'f2', nombre: 'Datos de venta', campana: 'Ventas', activo: true,
      campos: [
        { id: 'c1', etiqueta: 'Documento del cliente', tipo: 'texto', obligatorio: true, opciones: [] },
        { id: 'c2', etiqueta: 'Plan contratado', tipo: 'opcion', obligatorio: true,
          opciones: ['Hogar 100MB', 'Hogar 200MB', 'Móvil 8GB', 'Móvil 20GB', 'Full TV'] },
        { id: 'c3', etiqueta: 'Fecha de instalación', tipo: 'fecha', obligatorio: true, opciones: [] },
        { id: 'c4', etiqueta: 'Acepta términos', tipo: 'casilla', obligatorio: true, opciones: [] },
        { id: 'c5', etiqueta: 'Observaciones', tipo: 'texto_largo', obligatorio: false, opciones: [] },
      ],
    },
    {
      id: 'f3', nombre: 'Acuerdo de pago', campana: 'Cobranza', activo: true,
      campos: [
        { id: 'c1', etiqueta: 'Valor acordado', tipo: 'numero', obligatorio: true, opciones: [] },
        { id: 'c2', etiqueta: 'Fecha de pago', tipo: 'fecha', obligatorio: true, opciones: [] },
        { id: 'c3', etiqueta: 'Medio de pago', tipo: 'opcion', obligatorio: true,
          opciones: ['Transferencia', 'Efectivo', 'PSE', 'Tarjeta'] },
      ],
    },
  ];

  const TIPOS_CAMPO = [
    { id: 'texto',       nombre: 'Texto corto' },
    { id: 'texto_largo', nombre: 'Texto largo' },
    { id: 'numero',      nombre: 'Número' },
    { id: 'fecha',       nombre: 'Fecha' },
    { id: 'opcion',      nombre: 'Lista de opciones' },
    { id: 'casilla',     nombre: 'Casilla de verificación' },
  ];

  function formularios() {
    try {
      const g = localStorage.getItem(CLAVE_FORMS);
      if (g) return JSON.parse(g);
    } catch { /* modo privado */ }
    return JSON.parse(JSON.stringify(FORMULARIOS_BASE));
  }

  function guardarFormularios(lista) {
    try { localStorage.setItem(CLAVE_FORMS, JSON.stringify(lista)); } catch { /* nada */ }
  }

  /** Formularios activos de una campaña. Es lo que ve el agente. */
  function formulariosDe(campana) {
    return formularios().filter((f) => f.activo && (f.campana === campana || f.campana === 'Todas'));
  }

  /* ═════════════════════════════════════════════════════════════════
     RESPUESTAS SIN CONEXIÓN
     El agente diligencia; si el envío falla, la respuesta queda en una
     cola local con estado "pendiente" y se reintenta. Nunca se pierde.
     ═════════════════════════════════════════════════════════════════ */
  const CLAVE_COLA = 'bpm.respuestas.pendientes';

  function pendientes() {
    try { return JSON.parse(localStorage.getItem(CLAVE_COLA) || '[]'); }
    catch { return []; }
  }

  function guardarPendientes(lista) {
    try { localStorage.setItem(CLAVE_COLA, JSON.stringify(lista)); } catch { /* nada */ }
  }

  /** Encola una respuesta. Se guarda SIEMPRE antes de intentar enviarla. */
  function encolarRespuesta(resp) {
    const lista = pendientes();
    lista.push({
      ...resp,
      id: 'r' + Date.now() + Math.floor(Math.random() * 1000),
      creado: new Date().toISOString(),
      intentos: 0,
    });
    guardarPendientes(lista);
    return lista.length;
  }

  /**
   * Intenta enviar lo pendiente.
   * Reemplazar por: POST /api/respuestas
   * `hayRed` simula la disponibilidad del backend, para poder demostrar
   * el comportamiento sin conexión durante la presentación.
   */
  async function sincronizar(hayRed) {
    await demora(400);
    const lista = pendientes();
    if (!lista.length) return { enviadas: 0, quedan: 0 };
    if (hayRed === false) {
      lista.forEach((r) => { r.intentos++; });
      guardarPendientes(lista);
      throw new Error('Sin conexión con el servidor. Las respuestas quedan guardadas.');
    }
    guardarPendientes([]);
    return { enviadas: lista.length, quedan: 0 };
  }

  /* ═════════════════════════════════════════════════════════════════
     REPORTES · en producción salen de consultas sobre llamada/interaccion
     ═════════════════════════════════════════════════════════════════ */
  const TIPOS_REPORTE = [
    { id: 'agentes',  nombre: 'Actividad por agente',
      desc: 'Estado actual, llamadas atendidas y tiempo medio de operación.' },
    { id: 'campanas', nombre: 'Resumen por campaña',
      desc: 'Atendidas, abandonadas y nivel de servicio.' },
    { id: 'llamadas', nombre: 'Detalle de llamadas',
      desc: 'Una fila por llamada de esta sesión, con su tipificación.' },
    { id: 'pausas',   nombre: 'Pausas del turno',
      desc: 'Cuánto tiempo estuvo cada agente en cada pausa.' },
  ];

  /** Devuelve { columnas, filas } listo para pintar o descargar en CSV. */
  function generarReporte(tipo) {
    const v = estadoVivo();

    if (tipo === 'agentes') {
      return {
        columnas: ['Extensión', 'Agente', 'Campaña', 'Estado', 'Llamadas', 'TMO (s)'],
        filas: v.agentes.map((a) => [a.ext, a.nombre, a.campana, a.estado, a.llamadas, a.tmo]),
      };
    }
    if (tipo === 'campanas') {
      return {
        columnas: ['Campaña', 'Tipo', 'Activa', 'En espera', 'Atendidas', 'Abandonadas', 'Nivel (%)'],
        filas: CAMPANAS.map((c) => {
          const q = v.colas.find((x) => x.campana === c.nombre) || {};
          return [c.nombre, c.tipo, c.activa ? 'Sí' : 'No',
                  q.enEspera || 0, q.atendidas || 0, q.abandonadas || 0, q.nivel || 0];
        }),
      };
    }
    if (tipo === 'pausas') {
      const filas = [];
      v.agentes.forEach((a) => {
        ['Baño', 'Almuerzo', 'Break', 'Retroalimentación'].forEach((p) => {
          const seg = Math.floor(Math.random() * 900);
          if (seg > 60) filas.push([a.ext, a.nombre, p, seg, (seg / 60).toFixed(1)]);
        });
      });
      return { columnas: ['Extensión', 'Agente', 'Pausa', 'Segundos', 'Minutos'], filas };
    }
    return { columnas: [], filas: [] };   // 'llamadas' lo arma pantalla.js
  }

  /* ═════════════════════════════════════════════════════════════════
     HORARIOS
     "El supervisor puede tomar acciones como cerrar horarios."
     ═════════════════════════════════════════════════════════════════ */
  const CLAVE_HOR = 'bpm.horarios';
  const HORARIOS_BASE = [
    { id: 'h1', campana: 'Ventas',    inicio: '08:00', fin: '18:00', dias: 'Lun a Vie', abierto: true },
    { id: 'h2', campana: 'Soporte',   inicio: '07:00', fin: '21:00', dias: 'Lun a Sáb', abierto: true },
    { id: 'h3', campana: 'Cobranza',  inicio: '08:00', fin: '17:00', dias: 'Lun a Vie', abierto: true },
    { id: 'h4', campana: 'Retención', inicio: '09:00', fin: '16:00', dias: 'Lun a Vie', abierto: false },
  ];

  function horarios() {
    try {
      const g = localStorage.getItem(CLAVE_HOR);
      if (g) return JSON.parse(g);
    } catch { /* nada */ }
    return JSON.parse(JSON.stringify(HORARIOS_BASE));
  }
  function guardarHorarios(l) {
    try { localStorage.setItem(CLAVE_HOR, JSON.stringify(l)); } catch { /* nada */ }
  }

  /* ═════════════════════════════════════════════════════════════════
     CONFIGURACIÓN DE LA CENTRAL
     En producción esto NO viaja al navegador: lo sabe el backend y lo
     entrega junto con la credencial.
     ═════════════════════════════════════════════════════════════════ */
  /* ── Datos de la central ─────────────────────────────────────
     Vienen de js/config.js. No se piden al agente ni se guardan en el
     navegador: en producción los va a entregar el backend junto con la
     credencial.                                                        */
  function leerPbx() {
    return {
      wss: CONFIG.pbx.wss || '',
      dominio: CONFIG.pbx.dominio || '',
      clave: CONFIG.pbx.clave || '',
      ice: CONFIG.pbx.ice || [],
    };
  }

  function hayPbxConfigurada() {
    return !!(CONFIG.pbx.wss && CONFIG.pbx.dominio && !CONFIG.simulador);
  }

  async function autenticar(usuario, clave) {
    /* ── Con backend ── */
    if (hayApi()) {
      const d = await api('POST', '/sesion', { usuario, clave });
      guardarToken(d.token);
      return { ...d.usuario, usuario: d.usuario.usuario || usuario };
    }

    /* ── Sin backend: datos locales ── */
    await demora(350);
    const u = USUARIOS.find((x) => x.usuario === String(usuario).toLowerCase().trim());
    if (!u || !clave) throw new Error('Usuario o contraseña incorrectos.');
    if (!u.activo) throw new Error('Este usuario está inactivo.');
    return {
      id: u.usuario, usuario: u.usuario, nombre: u.nombre, rol: u.rol,
      campana: u.campana, extension: u.extension, clave: u.clave,
      permisos: permisosDeRol(u.rol),
    };
  }

  async function credencialSip(sesion) {
    /* Con backend, la credencial la emite el servidor: temporal y
       asociada a la sesión. El navegador nunca ve una clave fija. */
    if (hayApi()) {
      const d = await api('POST', '/sesion/sip');
      if (!d.wss || !d.dominio) throw new Error('SIN_PBX');
      return { ...d, ext: d.extension || d.ext };
    }

    await demora(250);
    const pbx = leerPbx();
    if (!pbx.wss || !pbx.dominio) throw new Error('SIN_PBX');
    return {
      wss: pbx.wss, dominio: pbx.dominio,
      ext: sesion.extension,
      clave: pbx.clave || generarClaveTemporal(),
      ice: pbx.ice,
      venceEn: 8 * 60 * 60,
      emitida: new Date(),
    };
  }

  async function cerrar() {
    /* Con backend, el servidor invalida la sesión y la credencial SIP.
       Así, si alguien copió la clave de telefonía, deja de servir. */
    if (hayApi()) {
      try { await api('DELETE', '/sesion'); } catch { /* da igual si falla */ }
      borrarToken();
      return;
    }
    await demora(120);
  }

  /* ═════════════════════════════════════════════════════════════════
     PERMISOS POR ROL
     El rol solo define QUÉ SE MUESTRA. No hay código distinto por rol,
     y por eso cambiar a alguien de rol no tiene ninguna complicación.
     ═════════════════════════════════════════════════════════════════ */
  function permisosDeRol(rol) {
    /* AGENTE — vista simplificada y operativa.
       Sin diseño de encuestas, sin reportería general, sin estado
       global de colas, sin administración de la PBX. Contactos e
       historial viven DENTRO del escritorio, no en el menú. */
    const agente = ['softphone', 'tipificar', 'ficha', 'historial_sesion'];

    /* SUPERVISOR — monitoreo y control de operaciones.
       Puede intervenir operativamente, pero NO puede borrar campañas
       ni diseñar formularios. */
    const supervisor = [...agente,
      'supervision',      // panel en vivo
      'horarios',         // cerrar y abrir campañas
      'distribucion',     // reasignar agentes entre campañas
      'grabaciones',      // buscador y reproductor
      'escucha',          // monitoreo en tiempo real
      'reportes',         // reportería con filtros
    ];

    /* SUPERADMINISTRADOR Y SOPORTE — herramientas maestras.
       No requiere softphone para su operación diaria. */
    const admin = [...supervisor,
      'disenar_formularios',  // exclusivo del superadmin
      'campanas',             // creación y eliminación
      'usuarios',             // usuarios, extensiones y roles
      'modulos',              // interruptor maestro
      'telefonia',            // diagnóstico y traza
    ];

    if (rol === 'admin') return admin;
    if (rol === 'supervisor') return supervisor;
    return agente;
  }

  const puede = (sesion, permiso) => !!(sesion && sesion.permisos && sesion.permisos.includes(permiso));

  /* ═════════════════════════════════════════════════════════════════
     UTILIDADES
     ═════════════════════════════════════════════════════════════════ */
  const demora = (ms) => new Promise((r) => setTimeout(r, ms));

  /** Solo para la demostración. El backend real usa un generador seguro. */
  function generarClaveTemporal() {
    const abc = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let s = '';
    for (let i = 0; i < 24; i++) s += abc[Math.floor(Math.random() * abc.length)];
    return s;
  }



  /* ═══════════════════════════════════════════════════════════════
     ACCESO AL BACKEND

     Si CONFIG.api tiene una dirección, la plataforma habla con el
     servidor. Si está vacía, trabaja con los datos locales de este
     archivo, como hasta ahora.

     Así se puede desarrollar y presentar sin backend, y activarlo
     cambiando una línea en js/config.js.
     ═══════════════════════════════════════════════════════════════ */

  const CLAVE_TOKEN = 'bpm.token';

  const hayApi = () => !!(typeof CONFIG !== 'undefined' && CONFIG.api);

  const guardarToken = (t) => { try { sessionStorage.setItem(CLAVE_TOKEN, t); } catch {} };
  const leerToken    = ()  => { try { return sessionStorage.getItem(CLAVE_TOKEN); } catch { return null; } };
  const borrarToken  = ()  => { try { sessionStorage.removeItem(CLAVE_TOKEN); } catch {} };

  /** Llamada al backend. Añade el token y traduce los errores. */
  async function api(metodo, ruta, cuerpo) {
    const token = leerToken();
    let r;
    try {
      r = await fetch(CONFIG.api + ruta, {
        method: metodo,
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: 'Bearer ' + token } : {}),
        },
        body: cuerpo ? JSON.stringify(cuerpo) : undefined,
      });
    } catch (e) {
      throw new Error('No se pudo conectar con el servidor. Revisa que esté encendido.');
    }

    let datos = null;
    try { datos = await r.json(); } catch {}

    if (r.status === 401 && ruta !== '/sesion') {
      borrarToken();
      throw new Error('La sesión expiró. Vuelve a iniciar sesión.');
    }
    if (!r.ok) throw new Error(datos?.error || 'Error ' + r.status);
    return datos;
  }


  /* ── Datos que el backend sirve cuando está conectado ──────────
     Todas devuelven lo mismo con o sin backend, así que las
     pantallas no cambian.                                          */

  /** Busca el contacto por teléfono. Es la consulta de cada llamada
      entrante: tiene que responder antes de que el agente conteste. */
  async function contactoPorTelefono(numero) {
    if (hayApi()) {
      try { return await api('GET', '/contactos/telefono/' + encodeURIComponent(numero)); }
      catch { return null; }
    }
    const n = String(numero || '').replace(/\D/g, '');
    return DIRECTORIO.find((c) => c.n.replace(/\D/g, '') === n) || null;
  }

  /** Catálogo de tipificación de la campaña del agente. */
  async function catalogoTipificacion(campana) {
    if (hayApi()) {
      try {
        const filas = await api('GET', '/tipificacion' + (campana ? '?campana=' + encodeURIComponent(campana) : ''));
        const cat = {};
        filas.forEach((f) => {
          cat[f.categoria] = cat[f.categoria] || [];
          if (f.subcategoria) cat[f.categoria].push(f.subcategoria);
        });
        return cat;
      } catch { /* si falla, se usa el local */ }
    }
    return CATALOGO;
  }

  /** Registra la tipificación de una llamada terminada. */
  async function guardarTipificacion(datos) {
    if (hayApi()) {
      try {
        await api('POST', '/interacciones/' + encodeURIComponent(datos.linkedid || 'sin-id') + '/tipificar', datos);
        return { ok: true, enviada: true };
      } catch (e) {
        return { ok: true, enviada: false, motivo: e.message };
      }
    }
    return { ok: true, enviada: false };
  }

  /** Inicio o fin de una pausa. */
  async function registrarPausa(tipo, entrando) {
    if (hayApi()) {
      try { await api('POST', '/pausas', { tipo, entrando }); return { ok: true }; }
      catch (e) { return { ok: false, error: e.message }; }
    }
    return { ok: true };
  }

  /* ── Gestión de usuarios ────────────────────────────────────────
     En producción esto son operaciones contra la base de datos.
     El rol solo define qué se muestra: no hay lógica distinta por
     rol, así que cambiarlo no requiere nada más.                    */

  function cambiarRol(usuario, rol) {
    const u = USUARIOS.find((x) => x.usuario === usuario);
    if (!u) return { ok: false, error: 'Usuario no encontrado' };
    u.rol = rol;
    return { ok: true };
  }

  function cambiarCampana(usuario, campana) {
    const u = USUARIOS.find((x) => x.usuario === usuario);
    if (!u) return { ok: false, error: 'Usuario no encontrado' };
    u.campana = campana;
    return { ok: true };
  }

  function guardarUsuario(datos) {
    const existe = USUARIOS.find((x) => x.usuario === datos.usuario);

    // Una extensión no puede compartirse entre dos personas
    const ext = String(datos.extension || '').trim();
    if (ext && USUARIOS.some((x) => x.extension === ext && x.usuario !== datos.usuario)) {
      return { ok: false, error: 'Esa extensión ya está asignada a otro usuario.' };
    }

    if (existe) {
      Object.assign(existe, datos);
    } else {
      USUARIOS.push({ ...datos, clave: '', activo: true });
    }
    return { ok: true };
  }

  function marcacionRapidaDe(campana) {
    return MARCACION_RAPIDA[campana] || MARCACION_RAPIDA['Todas'] || [];
  }

  return {
    autenticar, credencialSip, cerrar, puede,
    leerPbx, hayPbxConfigurada,
    estadoVivo, tictac,
    formularios, guardarFormularios, formulariosDe,
    pendientes, encolarRespuesta, sincronizar,
    generarReporte, horarios, guardarHorarios,
    cambiarRol, cambiarCampana, guardarUsuario, marcacionRapidaDe,
    hayApi, contactoPorTelefono, catalogoTipificacion,
    guardarTipificacion, registrarPausa,
    get usuarios()    { return USUARIOS.map((u) => ({ ...u })); },
    get campanas()    { return CAMPANAS.map((c) => ({ ...c })); },
    get tiposCampo()  { return TIPOS_CAMPO.map((t) => ({ ...t })); },
    get tiposReporte(){ return TIPOS_REPORTE.map((t) => ({ ...t })); },
  };
})();
