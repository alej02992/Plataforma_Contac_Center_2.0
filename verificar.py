#!/usr/bin/env python3
"""
BPM Consulting — Verificación de la instalación

Comprueba que todos los archivos estén completos y en su sitio ANTES de
abrir la plataforma. Evita perder tiempo diagnosticando en el navegador.

    python verificar.py
"""

import hashlib
import os
import sys

# Archivo, tamaño mínimo esperado
ARCHIVOS = [
    ("index.html", 20000),
    ("css/estilos.css", 15000),
    ("js/config.js", 1000),
    ("js/servicio.js", 10000),
    ("js/telefonia.js", 15000),
    ("js/supervision.js", 5000),
    ("js/formularios.js", 8000),
    ("js/pantalla.js", 25000),
    ("lib/sip.js", 600000),
]

SIP_BYTES = 602865
SIP_SHA = "b6edd4954597f1a853110f20605fb031"

VERDE = "\033[92m"
ROJO = "\033[91m"
AMBAR = "\033[93m"
FIN = "\033[0m"


def main() -> int:
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    print()
    print("  BPM Consulting — Verificación de la instalación")
    print("  " + "─" * 52)
    print()

    fallos = 0

    for ruta, minimo in ARCHIVOS:
        if not os.path.exists(ruta):
            print(f"  {ROJO}FALTA{FIN}   {ruta}")
            fallos += 1
            continue

        tam = os.path.getsize(ruta)
        if tam < minimo:
            print(f"  {ROJO}CORTO{FIN}   {ruta} · {tam:,} bytes "
                  f"(se esperaban al menos {minimo:,})")
            fallos += 1
        else:
            print(f"  {VERDE}OK{FIN}      {ruta} · {tam:,} bytes")

    # La librería se verifica byte a byte: es la que más problemas da
    print()
    if os.path.exists("lib/sip.js"):
        datos = open("lib/sip.js", "rb").read()
        sha = hashlib.sha256(datos).hexdigest()[:32]

        if len(datos) != SIP_BYTES:
            print(f"  {ROJO}La librería está incompleta.{FIN}")
            print(f"     Tiene {len(datos):,} bytes y debe tener {SIP_BYTES:,}.")
            print("     Vuelve a descargarla o regenérala con esbuild.")
            fallos += 1
        elif sha != SIP_SHA:
            print(f"  {AMBAR}La librería tiene el tamaño correcto pero otro contenido.{FIN}")
            print("     Puede ser otra versión. Debería funcionar igual.")
        elif not datos.startswith(b"var SIP = (("):
            print(f"  {ROJO}La librería no expone la variable SIP.{FIN}")
            print("     Se generó sin --global-name=SIP")
            fallos += 1
        else:
            print(f"  {VERDE}La librería de telefonía está íntegra.{FIN}")

    # El error clásico: el sustituto dentro del HTML
    if os.path.exists("index.html"):
        html = open("index.html", encoding="utf-8", errors="ignore").read()
        if "const SIP = {" in html:
            print()
            print(f"  {ROJO}El index.html contiene un sustituto de la librería.{FIN}")
            print("     Ese bloque sobrescribe la librería real. Hay que borrarlo.")
            fallos += 1
        if 'src="lib/sip.js"' not in html:
            print()
            print(f"  {ROJO}El index.html no enlaza lib/sip.js{FIN}")
            fallos += 1

    # Estado de la configuración
    print()
    if os.path.exists("js/config.js"):
        cfg = open("js/config.js", encoding="utf-8").read()
        import re
        wss = re.search(r"wss:\s*'([^']*)'", cfg)
        sim = re.search(r"simulador:\s*(true|false)", cfg)
        wss = wss.group(1) if wss else ""
        sim = sim.group(1) if sim else "?"

        if not wss:
            print(f"  {AMBAR}Central sin configurar{FIN} · las llamadas se simulan")
            print("     Llena pbx.wss y pbx.dominio en js/config.js")
        elif sim == "true":
            print(f"  {AMBAR}Central configurada pero simulador en true{FIN}")
            print(f"     Central: {wss}")
            print("     Pon simulador: false para llamadas reales")
        else:
            print(f"  {VERDE}Telefonía real activa{FIN}")
            print(f"     Central: {wss}")

    print()
    print("  " + "─" * 52)
    if fallos:
        print(f"  {ROJO}{fallos} problema(s). Corrígelos antes de abrir la plataforma.{FIN}")
    else:
        print(f"  {VERDE}Todo correcto. Ejecuta: python servir.py{FIN}")
    print()
    return 1 if fallos else 0


if __name__ == "__main__":
    sys.exit(main())
