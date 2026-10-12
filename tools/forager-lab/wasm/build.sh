#!/bin/sh
# Builds forager.wasm from forager.c with clang (wasm32, freestanding) and wasm-ld.
cd "$(dirname "$0")" || exit 1
clang --target=wasm32 -O3 -nostdlib -mbulk-memory -msimd128 -fno-builtin -Wall -Wno-unused-function \
  -Wl,--no-entry -o forager.wasm forager.c 2>&1 || exit 1
ls -l forager.wasm
