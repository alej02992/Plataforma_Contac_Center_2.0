# BPM Consulting — Plataforma de Contact Center

Softphone web con SIP.js y WebRTC, tipificador, formularios, panel de
supervisión y diseñador de formularios. Tres perfiles de usuario.

---

## Antes de nada: verifica la instalación

```bash
python verificar.py
```

Comprueba que todos los archivos estén completos y en su sitio. Sobre
todo `lib/sip.js`, que debe pesar **602.865 bytes** — si se copia entre
equipos es fácil que llegue truncado, y ese es el fallo más frecuente.

Solo cuando diga «Todo correcto», sigue adelante.

## Arrancar

```bash
python servir.py
```

Abre `http://localhost:8080`.

> **No abras `index.html` con doble clic.** Eso usa `file://`, que el
> navegador no considera contexto seguro, y el micrófono no va a
> funcionar. El servidor es requisito del navegador, no del proyecto.

En Windows el comando suele ser `python`, no `python3`.
Para acceder desde otro equipo de la red: `python servir.py --https`

---

## Conectar con el backend

En `js/config.js`:

```js
api: 'http://localhost:3001/api',
```

Con esa dirección puesta, la plataforma autentica contra el servidor,
pide la credencial SIP temporal, busca los contactos en MySQL y envía
las tipificaciones.

Si se deja **vacía**, trabaja con los datos locales de `js/servicio.js`.
Así se puede desarrollar y presentar sin backend.

El estado se ve en la traza al iniciar sesión: dice si hay backend
conectado o si está usando datos locales.

## Conectar con la central

**Todo se configura en `js/config.js`.** Es el único archivo que hay que
editar; no hay pantallas de configuración ni datos que pedirle al agente.

```js
pbx: {
  wss:     'wss://pbx-dev.empresa.com:8089/ws',
  dominio: 'pbx-dev.empresa.com',
  clave:   '...',
  ice: [
    { urls: 'stun:stun.empresa.com:3478' },
    { urls: 'turn:turn.empresa.com:3478',
      username: 'usuario', credential: 'clave' },
  ],
},
simulador: false,     // ← ponerlo en false activa la telefonía real
```

Mientras `simulador` esté en `true`, las llamadas no salen a la central.
Con el simulador activo, **Ctrl+Shift+L** genera una llamada entrante
para recorrer el flujo completo.

Los datos de la central los entrega quien administra Asterisk. Sin
servidor TURN, el audio solo va a funcionar dentro de la red de la
empresa.

---

## Usuarios

| Usuario | Perfil | Extensión | Campaña |
|---|---|---|---|
| `ana` | Agente | 4021 | Ventas |
| `pedro` | Agente | 4022 | Soporte |
| `lucia` | Agente | 4033 | Cobranza |
| `sandra` | Supervisor | 4100 | Ventas |
| `admin` | Superadministrador | 4001 | Todas |

Mientras no exista el backend, la validación de contraseña no es real:
cualquiera entra. Los usuarios están definidos en `js/servicio.js`.

### Qué ve cada perfil

**Agente** — Escritorio (softphone, ficha del contacto y tipificador en
una sola pantalla), Formularios, Contactos e Historial.

**Supervisor** — todo lo anterior más Seguimiento de la operación,
Reportes y Diseñador de formularios.

**Superadministrador** — todo lo anterior más Diagnóstico y Traza SIP.

El menú se arma con los permisos que devuelve el servicio, así que
cambiar el perfil de una persona cambia lo que ve sin tocar código.

---

## Archivos

```
escritorio/
├── index.html            estructura de todas las pantallas
├── css/
│   └── estilos.css       colores de marca en :root
├── js/
│   ├── config.js         ← lo único que hay que editar
│   ├── servicio.js       usuarios, credenciales y datos
│   ├── telefonia.js      llamadas: SIP.js y WebRTC
│   ├── supervision.js    panel del supervisor
│   ├── formularios.js    captura y diseñador
│   └── pantalla.js       la interfaz
├── lib/
│   └── sip.js            SIP.js 0.21.2 (no se toca)
├── servir.py             servidor local
├── verificar.py          comprueba la instalación
└── LEEME.md
```

### La separación que importa

**`js/telefonia.js` es el único archivo que toca SIP.js.** Mantiene el
estado de la llamada y avisa de los cambios por medio de eventos.

**`js/pantalla.js` no sabe que SIP existe.** Solo escucha esos eventos.

Cuando se migre a React, `telefonia.js` se copia casi tal cual a
`servicioTelefonia.ts` y la interfaz se reescribe como componentes, sin
volver a resolver la telefonía.

**`js/servicio.js` representa al backend.** Cuando exista, se reemplazan
sus funciones por llamadas HTTP y nada más cambia:

```
POST /api/sesion          { usuario, clave }
  → { id, nombre, rol, campana, extension, permisos }

POST /api/sip/credencial
  → { wss, dominio, extension, clave, ice, venceEn }
```

---

## Funciones

### Softphone

Teclado que marca en reposo y envía tonos DTMF durante la llamada.
Silenciar, espera, cronómetro e insignias de estado. Reconexión
automática con espera creciente si se cae la red.

### Transferencia

Tres destinos:

- **Extensión** — a un compañero; sugiere el nombre mientras se escribe.
- **Campaña** — entra a la cola y la toma el primer agente libre. Si la
  campaña está cerrada, avisa y no permite transferir.
- **Externo** — celular (10 dígitos desde 3) o fijo (60 + 8 dígitos).
  Valida el formato y advierte que sale por la troncal.

Cada una en modalidad ciega o consultada.

### Tipificación

Se abre al terminar la llamada, con cuenta regresiva. Si se agota el
tiempo, la llamada queda registrada sin tipificar.

### Formularios

El agente llena el formulario asignado a su campaña. **La respuesta se
guarda en el equipo antes de intentar enviarse**, de modo que no se
pierde si el servidor no responde. Las que no salieron quedan en
Pendientes con su contador de intentos.

Mientras `CONFIG.api` esté vacío no hay servidor a donde enviar, así que
todas las respuestas se acumulan ahí.

### Supervisión

Indicadores en vivo, llamadas en cola, estado de cada agente con el
tiempo que lleva en él, y estado de campañas con sus horarios. El
supervisor puede abrir y cerrar campañas.

### Reportes

Se generan con los datos del momento y se descargan en CSV.

### Diseñador de formularios

Nombre, campaña y campos con su tipo (texto, número, fecha, lista,
sí/no, párrafo). Se marcan los obligatorios y se reordenan. Lo que se
guarda aquí es lo que ve el agente.

---

## Atajos de teclado

| Tecla | Acción |
|---|---|
| `0-9`, `*`, `#` | Marcar o enviar DTMF |
| `Enter` | Llamar, o contestar si está timbrando |
| `Escape` | Colgar |
| `Ctrl+Shift+L` | Generar llamada entrante (solo con el simulador) |

---

## Si algo falla

**No se ven los estilos.** El navegador guardó la versión anterior en
caché. **Ctrl+Shift+R**.

**El micrófono no funciona.** Casi siempre la página no está en contexto
seguro. Entra como administrador y ejecuta *Diagnóstico*: el paso 1 lo
confirma.

**Registra pero no se escucha.** Es ICE o el rango de puertos RTP en el
firewall. En *Diagnóstico*, si el paso 5 solo encuentra candidatos
`host`, el audio solo va a funcionar dentro de la red y hace falta un
servidor TURN.

**Pantalla en blanco.** Abre la consola con F12. Si dice que no
encuentra un archivo, ejecuta `python verificar.py`.

**Dice que no cargó la librería.** Ejecuta `python verificar.py`. Las
dos causas habituales son que `lib/sip.js` esté incompleto, o que el
`index.html` tenga incrustado un sustituto de la librería — el
verificador detecta ambas.

**No hace llamadas reales.** El verificador te dice en qué estado está:
si falta configurar la central, o si `simulador` sigue en `true`.

---

## Estado actual

Construido y funcionando:

- Softphone completo con SIP.js y WebRTC
- Tipificación, contactos, historial
- Formularios con cola de envío
- Supervisión, reportes y diseñador de formularios
- Tres perfiles con permisos

Pendiente:

- **Backend.** Autenticación real, base de datos y persistencia. Hoy los
  datos viven en `js/servicio.js` y en el navegador.
- **Validar contra Asterisk.** La telefonía está escrita pero no se ha
  probado contra una central real.
- **Credenciales SIP por sesión.** Requiere Asterisk leyendo su
  configuración desde MySQL.
- **Eventos en vivo desde Asterisk.** Las llamadas en cola y el estado de
  los agentes necesitan que el backend escuche el AMI.

---

## Antes de compartir la traza

En los mensajes de registro aparece la contraseña SIP. Es cómo funciona
el protocolo, no un descuido. Revísala antes de enviarla.
