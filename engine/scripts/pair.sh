#!/usr/bin/env bash
# Stack the paper-print and bold-editorial stills of one component side by side,
# labelled, so the "two maximally different themes" acceptance test is one image.
set -e
E=/home/thiago/lusora/engine/fixtures/preview
OUT=${OUT:-/tmp/claude-1000/-home-thiago-lusora/7afb3297-b2d0-48a0-bee3-6a4bc7a30e36/scratchpad/pairs}
mkdir -p "$OUT"
for C in "$@"; do
  ffmpeg -y -v error -i "$E/paper-print/$C.png" -i "$E/bold-editorial/$C.png" \
    -filter_complex "[0:v]scale=640:-1,pad=640:380:0:0:0x101010[a];[1:v]scale=640:-1,pad=640:380:0:0:0x101010[b];[a][b]hstack=inputs=2" \
    -frames:v 1 "$OUT/$C.png"
done
echo "pairs -> $OUT"
