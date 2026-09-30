#!/bin/sh
set -eu
cd "$(dirname "$0")"
[ -d build/src-vtracer ] || git clone -q https://github.com/visioncortex/vtracer.git build/src-vtracer
git -C build/src-vtracer checkout -q 2500df76b5aea0ac22d15296b22722442f825c5b
ROOT="$(pwd)"
OUT="$ROOT/${OUT:-dist}/vtracer-v2"
export RUSTFLAGS="--remap-path-prefix=${CARGO_HOME:-$HOME/.cargo}=/cargo --remap-path-prefix=$ROOT=/src"
cd vtracer
wasm-pack build --target web --release --out-dir "$OUT" --out-name vtracer --no-typescript --no-pack
rm -f "$OUT/.gitignore"
! grep -nE 'eval\(|new Function' "$OUT/vtracer.js"
ls -l "$OUT"
