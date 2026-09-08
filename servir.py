#!/usr/bin/env python3
"""
BPM Consulting — Fase 0
Servidor local para la prueba de concepto.

POR QUÉ HACE FALTA
------------------
El navegador solo entrega el micrófono en un "contexto seguro":
HTTPS con certificado válido, o http://localhost.

Abrir index.html con doble clic usa file://, que NO es contexto seguro:
el paso 2 del diagnóstico va a fallar siempre.

USO
---
    python3 servir.py              # http://localhost:8080  (mismo equipo)
    python3 servir.py --https      # https://0.0.0.0:8443   (desde otro equipo de la red)
    python3 servir.py --port 9000

El modo --https genera un certificado autofirmado. El navegador va a
mostrar una advertencia: acéptala manualmente. Sirve para probar desde
otro equipo de la red, donde localhost ya no aplica.
"""

import argparse
import http.server
import os
import socket
import ssl
import subprocess
import sys
import tempfile

CERT = os.path.join(tempfile.gettempdir(), "bpm_poc_cert.pem")
KEY = os.path.join(tempfile.gettempdir(), "bpm_poc_key.pem")


class Handler(http.server.SimpleHTTPRequestHandler):
    """Sirve los archivos sin caché, para que los cambios se vean al recargar."""

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate")
        self.send_header("Pragma", "no-cache")
        super().end_headers()

    def log_message(self, fmt, *args):
        # Solo mostramos errores; el ruido de cada archivo no aporta.
        if args and str(args[1]).startswith(("4", "5")):
            sys.stderr.write("  %s %s\n" % (args[0], args[1]))


def ip_local() -> str:
    """IP con la que este equipo se ve desde la red."""
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("8.8.8.8", 80))
        return s.getsockname()[0]
    except Exception:
        return "127.0.0.1"
    finally:
        s.close()


def generar_certificado() -> bool:
    """Crea un certificado autofirmado con openssl."""
    if os.path.exists(CERT) and os.path.exists(KEY):
        return True
    print("  Generando certificado autofirmado…")
    try:
        subprocess.run(
            ["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes",
             "-keyout", KEY, "-out", CERT, "-days", "365",
             "-subj", "/C=CO/ST=Bogota/L=Bogota/O=BPM Consulting/CN=bpm-poc"],
            check=True, capture_output=True,
        )
        return True
    except FileNotFoundError:
        print("  ERROR: no se encontró 'openssl'. Instálalo o usa el modo sin --https.")
        return False
    except subprocess.CalledProcessError as e:
        print("  ERROR al generar el certificado:", e.stderr.decode()[:200])
        return False


def main() -> int:
    ap = argparse.ArgumentParser(description="Servidor de la prueba de concepto Fase 0")
    ap.add_argument("--port", type=int, default=None, help="puerto (8080 http, 8443 https)")
    ap.add_argument("--https", action="store_true", help="servir por HTTPS con certificado autofirmado")
    args = ap.parse_args()

    os.chdir(os.path.dirname(os.path.abspath(__file__)))

    if not os.path.exists("index.html"):
        print("ERROR: ejecuta este script desde la carpeta que contiene index.html")
        return 1
    if not os.path.exists(os.path.join("lib", "sip.js")):
        print("ERROR: falta lib/sip.js — el paquete está incompleto")
        return 1

    puerto = args.port or (8443 if args.https else 8080)
    servidor = http.server.ThreadingHTTPServer(("0.0.0.0", puerto), Handler)

    print()
    print("  BPM Consulting — Fase 0 · Prueba de concepto")
    print("  " + "─" * 52)

    if args.https:
        if not generar_certificado():
            return 1
        ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        ctx.load_cert_chain(CERT, KEY)
        servidor.socket = ctx.wrap_socket(servidor.socket, server_side=True)
        print(f"  Este equipo:   https://localhost:{puerto}")
        print(f"  Desde la red:  https://{ip_local()}:{puerto}")
        print()
        print("  El navegador va a advertir del certificado: es normal.")
        print("  Elige 'Configuración avanzada' y continúa.")
    else:
        print(f"  Abre:          http://localhost:{puerto}")
        print()
        print("  localhost SÍ es contexto seguro, el micrófono va a funcionar.")
        print("  Para probar desde OTRO equipo de la red, usa:  python3 servir.py --https")

    print()
    print("  Ctrl+C para detener")
    print()

    try:
        servidor.serve_forever()
    except KeyboardInterrupt:
        print("\n  Servidor detenido\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
