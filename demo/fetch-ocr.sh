#!/usr/bin/env sh
# Downloads the text reader (Tesseract) used by the demo into demo/ocr/.
# The demo host serves .js and .txt but not .gz, so the English model is stored
# as base64 text and a small shim in ocr/worker.js decodes it.
set -e
cd "$(dirname "$0")"
tmp=$(mktemp -d)
(cd "$tmp" && npm init -y >/dev/null && npm install --silent tesseract.js@5.1.1 tesseract.js-core@5.1.1 @tesseract.js-data/eng@1.0.0)
m="$tmp/node_modules"
mkdir -p ocr/core ocr/lang
cp "$m/tesseract.js-core/tesseract-core-simd-lstm.wasm.js" "$m/tesseract.js-core/tesseract-core-lstm.wasm.js" ocr/core/
base64 < "$m/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz" | tr -d '\n' > ocr/lang/eng.traineddata.txt
cat worker-shim.js "$m/tesseract.js/dist/worker.min.js" > ocr/worker.js
rm -rf "$tmp"
echo "Text reader files are in demo/ocr/"
