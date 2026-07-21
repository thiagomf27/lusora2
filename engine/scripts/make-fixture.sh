#!/usr/bin/env bash
# Builds engine/fixtures/video-dir/ — a tiny synthetic video working folder
# matching engine/fixtures/edit_plan.fixture.json — entirely with ffmpeg, so
# no media binaries are ever committed. Idempotent: wipes and recreates it.
#
# Contents: edit_plan.json (copy of the fixture), cfg.json (theme ref),
# audio.mp3 (8s tone voiceover), clips/town.mp4 (7s testsrc: 4s used at
# speed 1.5 = 6s of footage + margin), clips/forest.png (still),
# library/ambient.mp3 (2s loopable music bed).
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
dir="$repo_root/fixtures/video-dir"

rm -rf "$dir"
mkdir -p "$dir/clips" "$dir/library"

cp "$repo_root/fixtures/edit_plan.fixture.json" "$dir/edit_plan.json"

cat > "$dir/cfg.json" <<'EOF'
{
  "channel_id": "FIXTURE",
  "name": "Fixture Channel",
  "theme": "clean-plain",
  "editing": { "captions": true }
}
EOF

# 8s voiceover tone (defines total duration)
ffmpeg -y -v error -f lavfi -i "sine=frequency=220:sample_rate=44100" \
  -t 8 -c:a libmp3lame -q:a 6 "$dir/audio.mp3"

# 7s base video: 4s slot at speed 1.5 consumes 6s of footage; 7s leaves margin
ffmpeg -y -v error -f lavfi -i "testsrc2=size=1280x720:rate=30" \
  -t 7 -c:v libx264 -preset ultrafast -pix_fmt yuv420p "$dir/clips/town.mp4"

# gradient (not a flat color) so Ken Burns motion is visible in pixel diffs
ffmpeg -y -v error -f lavfi \
  -i "gradients=size=1280x720:x0=0:y0=0:x1=1280:y1=720:c0=0x1a4a2a:c1=0x0a0a2e" \
  -frames:v 1 "$dir/clips/forest.png"

# 2s loopable music bed
ffmpeg -y -v error -f lavfi -i "sine=frequency=440:sample_rate=44100" \
  -t 2 -c:a libmp3lame -q:a 6 "$dir/library/ambient.mp3"

echo "fixture ready: $dir"
