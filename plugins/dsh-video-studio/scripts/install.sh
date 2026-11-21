#!/usr/bin/env bash
set -euo pipefail
PROFILE="${1:-web}"
for command in node ffmpeg ffprobe dsh; do
  command -v "$command" >/dev/null 2>&1 || { echo "Missing required command: $command" >&2; exit 1; }
done
node -e 'const [major,minor]=process.versions.node.split(".").map(Number); if (major < 24 || (major === 24 && minor < 9)) { console.error(`Need Node.js 24.9+, got ${process.versions.node}`); process.exit(1); }'
FFMPEG_VERSION="$(ffmpeg -version | head -n 1)"
FFPROBE_VERSION="$(ffprobe -version | head -n 1)"
FFMPEG_MAJOR="$(printf '%s' "$FFMPEG_VERSION" | sed -E 's/.*version ([0-9]+).*/\1/')"
FFPROBE_MAJOR="$(printf '%s' "$FFPROBE_VERSION" | sed -E 's/.*version ([0-9]+).*/\1/')"
[[ "$FFMPEG_MAJOR" =~ ^[0-9]+$ ]] && (( FFMPEG_MAJOR >= 7 )) || { echo "Need FFmpeg 7+, got: $FFMPEG_VERSION" >&2; exit 1; }
[[ "$FFPROBE_MAJOR" =~ ^[0-9]+$ ]] && (( FFPROBE_MAJOR >= 7 )) || { echo "Need FFprobe 7+, got: $FFPROBE_VERSION" >&2; exit 1; }
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
command -v npm >/dev/null 2>&1 || { echo "Missing required command: npm" >&2; exit 1; }
(cd "$ROOT" && npm install --omit=dev --ignore-scripts --no-audit --no-fund)
dsh plugin --profile "$PROFILE" add "link:$ROOT"
echo "Install command completed. Confirm Video Studio is enabled in Harness Plugins, then call video_studio_status."
