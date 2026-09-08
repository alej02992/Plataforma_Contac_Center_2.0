/* ═══════════════════════════════════════════════════════════════════
   BPM CONSULTING — ESCRITORIO DEL AGENTE
   Archivo único · SIP.js + WebRTC · sin backend

   ORGANIZACIÓN (igual a la del documento técnico):

     telefonia   → único bloque que toca SIP.js. Expone una interfaz
                   estable y avisa de los cambios por medio de eventos.
     pantalla    → dibuja. No sabe nada de SIP.
     datos       → directorio y catálogo de demostración.

   Cuando se migre a React, `telefonia` se copia tal cual a
   servicioTelefonia.ts y las pantallas se reemplazan por componentes.
   ═══════════════════════════════════════════════════════════════════ */
'use strict';

const $ = (id) => document.getElementById(id);

/* Los datos de negocio (directorio y catálogo de tipificación) viven
   ahora en js/servicio.js, que es donde corresponde. Este archivo se
   ocupa únicamente de la telefonía.                                  */

/* ═══════════════════════════════════════════════════════════════════
   MÓDULO DE TELEFONÍA
   Único bloque que importa SIP.js. Todo lo demás lo consume por
   medio de `telefonia.on(evento, funcion)`.
   ═══════════════════════════════════════════════════════════════════ */
const telefonia = (() => {

  const est = {
    ua: null, registerer: null, session: null, consulta: null,
    registrado: false, estado: 'reposo',   // reposo|timbrando|marcando|activa|espera|cierre
    numero: null, direccion: null, inicio: null,
    silenciado: false, enEspera: false, esperaRemota: false,
    simulado: false, cfg: null, intentos: 0, statsId: null,
    campanas: [],        // las entrega el servicio al conectar
  };

  const oyentes = {};
  const on = (ev, fn) => { (oyentes[ev] = oyentes[ev] || []).push(fn); };
  const emitir = (ev, dato) => (oyentes[ev] || []).forEach((f) => f(dato));

  const traza = (txt, tipo = 'info') => emitir('traza', { txt, tipo });

  /* ── Servidores ICE ── */
  /* Acepta la lista ya armada de js/config.js, o texto suelto por si
     alguna vez vuelve a escribirse a mano. */
  function parsearIce(entrada) {
    if (Array.isArray(entrada)) return entrada;
    const lista = [];
    (entrada || '').split(/[\n,]+/).map((s) => s.trim()).filter(Boolean).forEach((linea) => {
      const [urls, username, credential] = linea.split('|').map((x) => x && x.trim());
      if (!urls) return;
      lista.push(username && credential ? { urls, username, credential } : { urls });
    });
    return lista;
  }

  /* Un firewall corporativo puede descartar la conexión sin responder
     nada. En ese caso la promesa nunca se resuelve y la interfaz queda
     esperando indefinidamente. Este límite lo evita. */
  function conLimite(promesa, ms, mensaje) {
    return Promise.race([
      promesa,
      new Promise((_, rechazar) =>
        setTimeout(() => rechazar(new Error(mensaje)), ms)),
    ]);
  }

  /* ── Opciones de medios ── */
  function medios() {
    const mic = est.cfg?.mic;
    return {
      constraints: {
        audio: mic
          ? { deviceId: { exact: mic }, echoCancellation: true, noiseSuppression: true, autoGainControl: true }
          : { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: false,
      },
    };
  }

  function uri(numero) {
    const limpio = String(numero).replace(/[\s()-]/g, '');
    const u = SIP.UserAgent.makeURI(`sip:${limpio}@${est.cfg.dominio}`);
    if (!u) throw new Error('Destino inválido: ' + numero);
    return u;
  }

  function cambiar(estado, extra = {}) {
    est.estado = estado;
    emitir('estado', { estado, numero: est.numero, direccion: est.direccion, ...extra });
  }

  /* ═══════════ CONEXIÓN ═══════════ */
  async function conectar(cfg) {
    est.cfg = cfg;
    // Sin librería no hay telefonía real, diga lo que diga la
    // configuración. Así la plataforma nunca queda inutilizable.
    const haySip = typeof SIP !== 'undefined' && typeof SIP.UserAgent === 'function';
    est.simulado = !!cfg.simulado || !haySip;
    if (!haySip && !cfg.simulado) {
      traza('Falta lib/sip.js: las llamadas se simulan', 'warn');
    }

    if (est.simulado) {
      est.registrado = true;
      traza('Modo demostración: sin conexión real a la central', 'warn');
      emitir('registro', { registrado: true, texto: 'Demostración' });
      cambiar('reposo');
      return;
    }

    traza('Conectando a ' + cfg.wss, 'info');

    est.ua = new SIP.UserAgent({
      uri: SIP.UserAgent.makeURI(`sip:${cfg.ext}@${cfg.dominio}`),
      transportOptions: { server: cfg.wss },
      authorizationUsername: cfg.ext,
      authorizationPassword: cfg.clave,
      displayName: cfg.nombre,
      logBuilder: constructorTraza,
      sessionDescriptionHandlerFactoryOptions: {
        peerConnectionConfiguration: { iceServers: parsearIce(cfg.ice) },
      },
      delegate: { onInvite: entrante },
    });

    est.ua.transport.onConnect = () => traza('Transporte conectado', 'ok');
    est.ua.transport.onDisconnect = (err) => {
      traza('Transporte desconectado' + (err ? ': ' + err.message : ''), 'err');
      reconectar();
    };

    await conLimite(est.ua.start(), 12000,
      'La central no respondió en 12 segundos. Puede estar bloqueada por el ' +
      'firewall, el certificado puede no ser válido, o la dirección puede ser incorrecta.');

    est.registerer = new SIP.Registerer(est.ua, { expires: CONFIG.registroExpira });
    est.registerer.stateChange.addListener((s) => {
      if (s === SIP.RegistererState.Registered) {
        est.registrado = true; est.intentos = 0;
        traza('Extensión ' + cfg.ext + ' registrada', 'ok');
        emitir('registro', { registrado: true, texto: 'Registrado · ' + cfg.ext });
      }
      if (s === SIP.RegistererState.Unregistered) {
        est.registrado = false;
        emitir('registro', { registrado: false, texto: 'Sin registrar' });
      }
    });

    await conLimite(est.registerer.register({
      requestDelegate: {
        onReject: (r) => {
          const c = r.message.statusCode;
          let pista = c === 401 || c === 403 ? 'contraseña incorrecta'
                    : c === 404 ? 'la extensión no existe'
                    : r.message.reasonPhrase;
          traza(`Registro rechazado: ${c} — ${pista}`, 'err');
          emitir('error', `Registro rechazado (${c}): ${pista}`);
        },
      },
    }), 12000, 'La central no respondió al registro en 12 segundos.');
  }

  /* Reconexión con espera creciente (ver sección 3.11 del documento) */
  async function reconectar() {
    est.registrado = false;
    emitir('registro', { registrado: false, texto: 'Reconectando…', reconectando: true });

    while (est.intentos < 10 && est.ua) {
      const espera = Math.min(30000, 2000 * 2 ** est.intentos);
      traza(`Reintento en ${espera / 1000} s…`, 'warn');
      await new Promise((r) => setTimeout(r, espera));
      est.intentos++;
      try {
        await est.ua.reconnect();
        await est.registerer.register();
        traza('Reconectado', 'ok');
        return;
      } catch (e) { /* sigue intentando */ }
    }
    traza('No se pudo reconectar. Avisa al supervisor.', 'err');
    emitir('registro', { registrado: false, texto: 'Sin conexión' });
  }

  async function desconectar() {
    try { await est.registerer?.unregister(); } catch (_) {}
    try { await est.ua?.stop(); } catch (_) {}
    est.ua = null; est.registerer = null; est.registrado = false;
  }

  /* ═══════════ LLAMADA ENTRANTE ═══════════ */
  function entrante(invitation) {
    // En pausa o ya en llamada: se rechaza con "ocupado"
    if (est.session || est.estado !== 'reposo' || est.pausa) {
      traza('Entrante rechazada: agente no disponible', 'warn');
      invitation.reject({ statusCode: 486 }).catch(() => {});
      return;
    }
    est.session = invitation;
    est.direccion = 'entrante';
    est.numero = invitation.remoteIdentity.uri.user || 'desconocido';
    traza('<<< INVITE de ' + est.numero, 'rx');
    vigilar(invitation);
    cambiar('timbrando');
  }

  /* ═══════════ LLAMADA SALIENTE ═══════════ */
  async function llamar(numero) {
    const destino = String(numero || '').trim();
    if (!destino || est.session) return;

    est.numero = destino;
    est.direccion = 'saliente';

    if (est.simulado) return simular(destino);

    try {
      const inviter = new SIP.Inviter(est.ua, uri(destino), {
        sessionDescriptionHandlerOptions: medios(),
        earlyMedia: true,
      });
      est.session = inviter;
      vigilar(inviter);
      cambiar('marcando');
      traza('>>> INVITE a ' + destino, 'tx');

      await inviter.invite({
        requestDelegate: {
          onProgress: (r) => {
            const c = r.message.statusCode;
            if (c === 180) emitir('progreso', 'Timbrando en el destino');
            if (c === 183) emitir('progreso', 'Audio de la central');
          },
          onReject: (r) => {
            const c = r.message.statusCode;
            const m = { 404:'el número no existe', 486:'ocupado', 480:'no disponible',
                        403:'la central no permite ese destino',
                        488:'sin códecs en común (revisa Opus)' }[c] || r.message.reasonPhrase;
            traza(`Rechazada: ${c} — ${m}`, 'err');
            emitir('error', `Llamada rechazada (${c}): ${m}`);
          },
        },
      });
    } catch (e) {
      traza('Error al llamar: ' + e.message, 'err');
      emitir('error', e.message);
      limpiar();
    }
  }

  /* ═══════════ CICLO DE VIDA ═══════════ */
  function vigilar(session) {
    let contestada = false;
    const t0 = Date.now();

    session.stateChange.addListener((s) => {
      if (s === SIP.SessionState.Established) {
        contestada = true;
        conectarAudio(session);
        est.inicio = Date.now();
        cambiar('activa');
        iniciarStats(session);
        vigilarEsperaRemota(session);
        traza('Llamada establecida', 'ok');
        emitir('paso6', true);
      }

      if (s === SIP.SessionState.Terminated) {
        detenerStats();
        const dur = contestada ? Math.round((Date.now() - est.inicio) / 1000) : 0;
        emitir('fin', {
          numero: est.numero, direccion: est.direccion,
          contestada, segundos: dur,
        });
        traza('Llamada finalizada' + (contestada ? ' · ' + dur + ' s' : ' sin contestar'), 'info');
        if (session === est.session) limpiar(contestada);
      }
    });
  }

  function limpiar(huboLlamada) {
    est.session = null; est.consulta = null;
    est.silenciado = false; est.enEspera = false; est.esperaRemota = false;
    // Si hubo conversación, pasa a cierre para tipificar
    cambiar(huboLlamada ? 'cierre' : 'reposo');
    if (!huboLlamada) { est.numero = null; est.direccion = null; }
  }

  function conectarAudio(session) {
    const pc = session.sessionDescriptionHandler?.peerConnection;
    const el = $('audioRemoto');
    if (!pc || !el) return traza('No se encontró la conexión de audio', 'err');

    const flujo = new MediaStream();
    pc.getReceivers().forEach((r) => { if (r.track) flujo.addTrack(r.track); });
    el.srcObject = flujo;
    el.volume = (est.cfg?.volumen ?? 100) / 100;
    if (est.cfg?.salida && el.setSinkId) el.setSinkId(est.cfg.salida).catch(() => {});
    el.play()
      .then(() => traza('Audio remoto conectado', 'ok'))
      .catch(() => emitir('error', 'Haz clic en la página para habilitar el audio'));
  }

  function vigilarEsperaRemota(session) {
    const pc = session.sessionDescriptionHandler?.peerConnection;
    if (!pc) return;
    const revisar = () => {
      const sdp = pc.currentRemoteDescription?.sdp || '';
      const remota = /a=(sendonly|inactive)/.test(sdp);
      if (remota !== est.esperaRemota) {
        est.esperaRemota = remota;
        emitir('insignias', insignias());
        traza(remota ? 'El otro extremo puso la llamada en espera'
                     : 'El otro extremo reanudó', 'info');
      }
    };
    pc.addEventListener('signalingstatechange', revisar);
  }

  /* ═══════════ ACCIONES ═══════════ */
  async function contestar() {
    if (!est.session) return;
    if (est.simulado) { est.inicio = Date.now(); cambiar('activa'); return; }
    try { await est.session.accept({ sessionDescriptionHandlerOptions: medios() }); }
    catch (e) { traza('Error al contestar: ' + e.message, 'err'); }
  }

  async function colgar() {
    const s = est.session;
    if (est.simulado) {
      const hubo = est.estado === 'activa' || est.estado === 'espera';
      emitir('fin', { numero: est.numero, direccion: est.direccion, contestada: hubo,
                      segundos: hubo ? Math.round((Date.now() - est.inicio) / 1000) : 0 });
      return limpiar(hubo);
    }
    if (!s) return limpiar(false);
    try {
      if (s.state === SIP.SessionState.Established) await s.bye();
      else if (s.state === SIP.SessionState.Initial || s.state === SIP.SessionState.Establishing) {
        if (s instanceof SIP.Inviter) await s.cancel(); else await s.reject();
      }
    } catch (e) { traza('Error al colgar: ' + e.message, 'err'); }
  }

  async function rechazar() {
    if (est.simulado) { emitir('fin', { numero: est.numero, direccion: 'entrante',
      contestada: false, segundos: 0 }); return limpiar(false); }
    try { await est.session?.reject(); } catch (_) {}
    limpiar(false);
  }

  /* Silenciar: apaga la pista local. La central ni se entera. */
  function silenciar(activo) {
    est.silenciado = activo;
    const pc = est.session?.sessionDescriptionHandler?.peerConnection;
    pc?.getSenders().forEach((s) => {
      if (s.track && s.track.kind === 'audio') s.track.enabled = !activo;
    });
    traza(activo ? 'Micrófono silenciado' : 'Micrófono activo', 'info');
    emitir('insignias', insignias());
  }

  /* Espera: renegociación SIP. Asterisk pone la música. */
  async function espera(activo) {
    if (est.simulado) {
      est.enEspera = activo; cambiar(activo ? 'espera' : 'activa');
      emitir('insignias', insignias()); return true;
    }
    const s = est.session;
    if (!s || s.state !== SIP.SessionState.Established) return false;
    try {
      await s.invite({ sessionDescriptionHandlerOptions: { hold: activo } });
      est.enEspera = activo;
      cambiar(activo ? 'espera' : 'activa');
      emitir('insignias', insignias());
      traza(activo ? 'Llamada en espera' : 'Llamada reanudada', 'info');
      return true;
    } catch (e) {
      traza('La central rechazó la renegociación: ' + e.message, 'err');
      emitir('error', 'No se pudo poner en espera');
      return false;
    }
  }

  function tono(digito) {
    if (est.simulado) return true;
    const sdh = est.session?.sessionDescriptionHandler;
    if (sdh?.sendDtmf && sdh.sendDtmf(digito)) { traza('>>> DTMF ' + digito, 'tx'); return true; }
    traza('La central no aceptó el tono ' + digito, 'warn');
    return false;
  }

  /* ═══════════ TRANSFERENCIAS ═══════════
     Tres tipos de destino, según lo definido en la reunión:

       'campana'   → a la cola de una campaña. El destino es la
                     extensión de la cola en Asterisk (p. ej. 8001).
       'extension' → a otro agente.
       'externo'   → a un celular o fijo. Sale por la TRONCAL, así que
                     consume un canal y muestra el identificador que la
                     planta tenga configurado.
     ═══════════════════════════════════════ */

  /** Normaliza un número colombiano y valida que tenga sentido. */
  function normalizarExterno(numero) {
    let n = String(numero).replace(/[^\d+]/g, '');
    n = n.replace(/^\+?57/, '');          // quitar indicativo de país
    if (/^3\d{9}$/.test(n)) return { ok: true, numero: n, clase: 'Celular' };
    if (/^60\d{8}$/.test(n)) return { ok: true, numero: n, clase: 'Fijo' };
    if (/^\d{7}$/.test(n))   return { ok: true, numero: n, clase: 'Fijo local' };
    if (/^01800\d{7}$/.test(n)) return { ok: true, numero: n, clase: 'Línea gratuita' };
    return { ok: false, numero: n,
             motivo: 'No parece un número colombiano válido. ' +
                     'Celular: 10 dígitos empezando en 3. Fijo: 60 + 8 dígitos.' };
  }

  /**
   * Traduce un destino a la cadena que hay que marcar en Asterisk.
   * Devuelve { destino, etiqueta } o lanza un error explicativo.
   */
  function resolverDestino(tipo, valor) {
    if (tipo === 'campana') {
      const c = (est.campanas || []).find((x) => x.id === valor || x.nombre === valor);
      if (!c) throw new Error('Esa campaña no existe.');
      if (!c.activa) throw new Error(`La campaña ${c.nombre} está inactiva.`);
      return { destino: c.ext, etiqueta: `campaña ${c.nombre}` };
    }
    if (tipo === 'externo') {
      const r = normalizarExterno(valor);
      if (!r.ok) throw new Error(r.motivo);
      return { destino: r.numero, etiqueta: `${r.clase} ${r.numero}` };
    }
    const ext = String(valor).replace(/\D/g, '');
    if (!ext) throw new Error('Escribe una extensión.');
    return { destino: ext, etiqueta: `extensión ${ext}` };
  }

  async function transferirCiega(destino) {
    if (!est.session) return;
    try {
      traza('>>> REFER (ciega) a ' + destino, 'tx');
      await est.session.refer(uri(destino), {
        requestDelegate: {
          onAccept: () => traza('Transferencia aceptada', 'ok'),
          onReject: (r) => { traza('Rechazada: ' + r.message.statusCode, 'err');
                             emitir('error', 'La central rechazó la transferencia'); },
        },
      });
    } catch (e) { emitir('error', e.message); }
  }

  async function transferirConsultada(destino) {
    if (!est.session) return false;
    try {
      await espera(true);                       // 1. cliente en espera
      traza('Consulta: llamando a ' + destino, 'info');
      const consulta = new SIP.Inviter(est.ua, uri(destino), {
        sessionDescriptionHandlerOptions: medios(),
      });
      est.consulta = consulta;
      consulta.stateChange.addListener((s) => {
        if (s === SIP.SessionState.Established) {
          conectarAudio(consulta);
          traza('Consulta establecida', 'ok');
        }
        if (s === SIP.SessionState.Terminated && est.consulta === consulta) {
          est.consulta = null; emitir('consulta', null);
        }
      });
      await consulta.invite();                  // 2. hablar con el compañero
      emitir('consulta', destino);
      return true;
    } catch (e) {
      traza('Error en la consulta: ' + e.message, 'err');
      emitir('error', e.message);
      await espera(false);
      return false;
    }
  }

  async function unir() {
    if (!est.session || !est.consulta) return;
    try {
      traza('>>> REFER uniendo las dos llamadas', 'tx');
      await est.session.refer(est.consulta, {   // 3. el REFER apunta a la sesión
        requestDelegate: {
          onAccept: () => traza('Transferencia completada', 'ok'),
          onReject: (r) => emitir('error', 'La central rechazó la unión: ' + r.message.statusCode),
        },
      });
      est.consulta = null; emitir('consulta', null);
    } catch (e) { emitir('error', e.message); }
  }

  async function cancelarConsulta() {
    const c = est.consulta;
    try {
      if (c?.state === SIP.SessionState.Established) await c.bye();
      else if (c instanceof SIP.Inviter) await c.cancel();
    } catch (_) {}
    est.consulta = null;
    emitir('consulta', null);
    await espera(false);
  }

  /* ═══════════ ESTADÍSTICAS ═══════════ */
  function iniciarStats(session) {
    detenerStats();
    const pc = session.sessionDescriptionHandler?.peerConnection;
    if (!pc) return;
    est.statsId = setInterval(async () => {
      try {
        const rep = await pc.getStats();
        let ent = null, sal = null, par = null, cod = null;
        rep.forEach((r) => {
          if (r.type === 'inbound-rtp' && r.kind === 'audio') ent = r;
          if (r.type === 'outbound-rtp' && r.kind === 'audio') sal = r;
          if (r.type === 'candidate-pair' && r.state === 'succeeded' && r.nominated) par = r;
          if (r.type === 'codec' && r.mimeType?.startsWith('audio')) cod = r;
        });
        const d = {};
        if (par) {
          const l = rep.get(par.localCandidateId), m = rep.get(par.remoteCandidateId);
          d.ruta = (l?.candidateType || '?') + ' ⇄ ' + (m?.candidateType || '?');
          d.rtt = par.currentRoundTripTime != null ? Math.round(par.currentRoundTripTime * 1000) + ' ms' : '—';
        }
        if (cod) d.codec = cod.mimeType.replace('audio/', '') + ' @ ' + cod.clockRate;
        if (ent) {
          const rec = ent.packetsReceived || 0, per = ent.packetsLost || 0;
          d.perdida = (rec ? ((per / (rec + per)) * 100).toFixed(1) : '0.0') + '%';
          d.jitter = ent.jitter != null ? Math.round(ent.jitter * 1000) + ' ms' : '—';
          d.entrada = Math.round((ent.bytesReceived || 0) / 1024) + ' KB';
        }
        emitir('calidad', d);
      } catch (_) {}
    }, 2000);
  }
  function detenerStats() { if (est.statsId) clearInterval(est.statsId); est.statsId = null; }

  /* ═══════════ MODO DEMOSTRACIÓN ═══════════ */
  function simular(destino) {
    cambiar('marcando');
    setTimeout(() => {
      if (est.estado !== 'marcando') return;
      est.inicio = Date.now();
      cambiar('activa');
      emitir('paso6', false);
    }, 2200);
  }

  function simularEntrante() {
    if (est.estado !== 'reposo' || est.pausa) return;
    const c = DIRECTORIO[Math.floor(Math.random() * 6)];
    est.numero = c.n; est.direccion = 'entrante';
    est.session = { simulada: true };
    cambiar('timbrando');
  }

  /* ═══════════ TRAZA DE SIP.js ═══════════ */
  function constructorTraza(nivel, categoria, etiqueta, contenido) {
    const t = String(contenido);
    if (nivel === 'debug' && !/Sending|Received/.test(t)) return;
    const tipo = nivel === 'error' ? 'err' : nivel === 'warn' ? 'warn'
               : t.includes('Sending') ? 'tx' : t.includes('Received') ? 'rx' : 'info';
    traza(t.length > 800 ? t.slice(0, 800) + '\n… (recortado)' : t, tipo);
  }

  function insignias() {
    const b = [];
    if (est.silenciado) b.push(['r', 'Silenciado']);
    if (est.enEspera) b.push(['a', 'En espera']);
    if (est.esperaRemota) b.push(['a', 'El otro lado esperó']);
    if (est.consulta) b.push(['b', 'En consulta']);
    return b;
  }

  return {
    on, conectar, desconectar, llamar, contestar, colgar, rechazar,
    silenciar, espera, tono, transferirCiega, transferirConsultada,
    unir, cancelarConsulta, simularEntrante, parsearIce, traza,
    resolverDestino, normalizarExterno,
    set campanas(v) { est.campanas = v || []; },
    get estado() { return est.estado; },
    get numero() { return est.numero; },
    get registrado() { return est.registrado; },
    get simulado() { return est.simulado; },
    get inicio() { return est.inicio; },
    get enEspera() { return est.enEspera; },
    get silenciado() { return est.silenciado; },
    get cfg() { return est.cfg; },
    set pausa(v) { est.pausa = v; },
    get pausa() { return est.pausa; },
    terminarCierre() { est.numero = null; est.direccion = null; cambiar('reposo'); },
  };
})();
