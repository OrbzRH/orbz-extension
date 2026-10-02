#!/bin/bash
# Zips the extension for a release: only what Chrome needs, nothing else.
set -euo pipefail
cd "$(dirname "$0")"
V=$(python3 -c "import json;print(json.load(open('manifest.json'))['version'])")
mkdir -p dist
rm -f "dist/orbz-extension-$V.zip"
zip -q -r "dist/orbz-extension-$V.zip" manifest.json background.js shared.js sidepanel.html sidepanel.css sidepanel.js icons -x '.*'
echo "dist/orbz-extension-$V.zip ($(du -h "dist/orbz-extension-$V.zip" | cut -f1))"
