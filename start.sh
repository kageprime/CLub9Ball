#!/bin/sh
cd "$(dirname "$0")"
if command -v node >/dev/null 2>&1; then exec node serve.mjs 8000; else exec python3 -m http.server 8000; fi
