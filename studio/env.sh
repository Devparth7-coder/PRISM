#!/bin/bash
# Sourceable studio environment: project-local Chromium shared libs + browser path.
export PLAYWRIGHT_BROWSERS_PATH=/home/user/prism/studio/pw-browsers
_LIBS="$(find /home/user/prism/studio/chromelibs -type d \( -name x86_64-linux-gnu -o -name lib \) 2>/dev/null | tr '\n' ':')"
export LD_LIBRARY_PATH="${_LIBS}${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
export PATH="/home/user/bin:$PATH"
