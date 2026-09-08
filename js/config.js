/* ═══════════════════════════════════════════════════════════════════
   BPM CONSULTING — CONFIGURACIÓN

   Este es el ÚNICO archivo que hay que editar para poner la plataforma
   a funcionar contra la central real. No se toca nada más.

   Cuando el servidor de desarrollo esté listo:
     1. Llenar `pbx.wss` y `pbx.dominio`.
     2. Poner `simulador: false`.
     3. Recargar.
   ═══════════════════════════════════════════════════════════════════ */
'use strict';

const CONFIG = {

  /* ── Central telefónica ────────────────────────────────────────
     Los datos que entrega quien administra Asterisk.               */
  pbx: {
    // Dirección del WebSocket seguro. Debe empezar por wss://
    wss: '',

    // Dominio SIP. A veces difiere del host del WebSocket.
    dominio: '',

    // Servidores ICE. El STUN público sirve para pruebas dentro de la
    // red. Para agentes fuera de la sede hace falta un TURN propio:
    //   { urls: 'turn:turn.empresa.com:3478',
    //     username: 'usuario', credential: 'clave' }
    ice: [
      { urls: 'stun:stun.l.google.com:19302' },
    ],

    // Clave SIP provisional, la misma para todas las extensiones.
    // Solo se usa mientras Asterisk no lea su configuración desde
    // MySQL. Con Realtime, el backend genera una clave por sesión.
    clave: '',
  },

  /* ── Backend ───────────────────────────────────────────────────
     Cuando exista, poner aquí su dirección. Mientras esté vacío, la
     plataforma trabaja con los datos locales y las respuestas de los
     formularios quedan en la cola de pendientes.                    */
  api: '',

  /* ── Operación ─────────────────────────────────────────────────  */

  // Segundos de cierre para tipificar (ACW).
  // Debe coincidir con el `wrapuptime` de la cola en Asterisk.
  acw: 60,

  // Cada cuántos segundos el navegador confirma su registro.
  registroExpira: 300,

  /* ── Modo de trabajo ───────────────────────────────────────────
     true  → las llamadas se simulan. Sirve para trabajar en la
             interfaz sin central y para presentar el flujo.
     false → se usa la central real definida arriba.

     Con el simulador activo, Ctrl+Shift+L genera una llamada
     entrante.                                                       */
  simulador: true,
};
