#!/bin/bash
# Restore session-ephemeral tooling for the PRISM video studio. Safe to re-run.
#   npm deps + Playwright headless shell -> studio/pw-browsers
#   static ffmpeg/ffprobe               -> studio/bin        (assets/ffmpeg.tar.xz or live download)
#   chromium shared libs                -> studio/chromelibs (assets/chromelibs.tar.xz)
#   footage / VO / score / scenes       -> studio/rec,vo,sfx,scenes,shots (assets/rec-final.tar.xz)
set -e
cd "$(dirname "$0")/.."
STUDIO=studio
mkdir -p "$STUDIO"/{bin,pw-browsers,chromelibs,shots,scenes/data,rec,vo,sfx,films,segments,assets}

# 1) npm deps
[ -d node_modules ] || npm install --no-audit --no-fund

# 2) static ffmpeg/ffprobe
if [ ! -x "$STUDIO/bin/ffmpeg" ]; then
  if [ -f "$STUDIO/assets/ffmpeg.tar.xz" ]; then
    tar -xJf "$STUDIO/assets/ffmpeg.tar.xz" -C "$STUDIO/bin"
  else
    curl -sL -o /tmp/ff.tar.xz https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz
    tar -xf /tmp/ff.tar.xz -C /tmp
    cp /tmp/ffmpeg-*-static/ffmpeg /tmp/ffmpeg-*-static/ffprobe "$STUDIO/bin/"
  fi
  chmod +x "$STUDIO/bin/ffmpeg" "$STUDIO/bin/ffprobe"
fi

# 3) headless chromium (project-local)
if [ ! -x "$STUDIO/pw-browsers/chromium_headless_shell-"*/chrome-headless-shell-linux64/chrome-headless-shell ]; then
  PLAYWRIGHT_BROWSERS_PATH="$PWD/$STUDIO/pw-browsers" npx playwright install chromium-headless-shell
  chmod +x "$STUDIO/pw-browsers/ffmpeg-"*/ffmpeg-linux 2>/dev/null || true
fi

# 4) chromium runtime shared libs (versioned .so + recreate unversioned symlinks)
if ! ldd "$STUDIO"/pw-browsers/chromium_headless_shell-*/chrome-headless-shell-linux64/chrome-headless-shell 2>/dev/null | grep -q "not found"; then
  :
else
  if [ -f "$STUDIO/assets/chromelibs.tar.xz" ]; then
    tar -xJf "$STUDIO/assets/chromelibs.tar.xz" -C "$STUDIO"
  else
    mkdir -p /tmp/debs && cd /tmp/debs
    apt-get download libnss3 libnspr4 libatk1.0-0t64 libatk-bridge2.0-0t64 libatspi2.0-0t64 \
      libcups2t64 libxkbcommon0 libasound2t64 libavahi-client3 libavahi-common3 libdrm2 libgbm1 \
      libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libpango-1.0-0 libcairo2 2>/dev/null || true
    for d in *.deb; do dpkg-deb -x "$d" "$OLDPWD/$STUDIO/chromelibs"; done
    cd "$OLDPWD"
  fi
  # recreate .so.N symlinks lost by workspace snapshot/extraction
  python3 - "$STUDIO/chromelibs" <<'PY'
import os,re,sys
for root,_,files in os.walk(sys.argv[1]):
    for f in files:
        m=re.match(r'(.*\.so\.\d+)\.\d[\d.]*$', f)
        if m and not os.path.exists(os.path.join(root,m.group(1))):
            os.symlink(f, os.path.join(root,m.group(1)))
PY
fi

# 5) footage + audio + scenes (optional; lets assembly run without re-recording)
if [ ! -f "$STUDIO/rec/pipeline.webm" ] && [ -f "$STUDIO/assets/rec-final.tar.xz" ]; then
  tar -xJf "$STUDIO/assets/rec-final.tar.xz" -C "$STUDIO"
fi

echo "bootstrap complete — now: source studio/env.sh"
