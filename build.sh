#!/bin/sh
set -e
cd "$(dirname "$0")"
[ -d build/potrace-1.16 ] || { mkdir -p build && tar xzf upstream/potrace-1.16.tar.gz -C build; }
P=build/potrace-1.16/src
OUT=${OUT:-dist}
mkdir -p "$OUT"
emcc -O3 -msimd128 -DVERSION='"1.16"' -I"$P" \
  src/vt.c "$P/potracelib.c" "$P/trace.c" "$P/decompose.c" "$P/curve.c" \
  -o "$OUT/potrace-v1.js" \
  -sMODULARIZE=1 -sEXPORT_ES6=1 -sEXPORT_NAME=createPotrace \
  -sENVIRONMENT="${ENVIRONMENT:-worker}" -sFILESYSTEM=0 \
  -sALLOW_MEMORY_GROWTH=1 -sMAXIMUM_MEMORY=2GB -sINITIAL_MEMORY=64MB \
  -sEXPORTED_FUNCTIONS=_vt_trace,_vt_release,_vt_paths,_vt_segments,_vt_len,_vt_error,_vt_out_w,_vt_out_h,_malloc,_free \
  -sEXPORTED_RUNTIME_METHODS=HEAPU8,UTF8ToString \
  -sDYNAMIC_EXECUTION=0 -sTEXTDECODER=2
