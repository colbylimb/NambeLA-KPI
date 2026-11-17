#!/usr/bin/env bash
# Nambe Drugs scorecard: Raspberry Pi kiosk launcher.
# Opens the dashboard full screen in Chromium and reopens it if it ever closes.
# Usage: ~/kiosk.sh [URL]
URL="${1:-https://colbylimb.github.io/NambeLA-KPI/}"

# Wait for the network (up to ~5 minutes) so Chromium doesn't open on an error page after a power cut.
for _ in $(seq 1 60); do
  curl -fsI --max-time 5 "$URL" >/dev/null 2>&1 && break
  sleep 5
done

BROWSER="$(command -v chromium || command -v chromium-browser)"
PREFS="$HOME/.config/chromium/Default/Preferences"

while true; do
  # Skip the "Chromium didn't shut down correctly" bar after a power loss.
  if [ -f "$PREFS" ]; then
    sed -i 's/"exited_cleanly":false/"exited_cleanly":true/; s/"exit_type":"[^"]*"/"exit_type":"Normal"/' "$PREFS"
  fi
  "$BROWSER" \
    --kiosk "$URL" \
    --noerrdialogs --disable-infobars --no-first-run \
    --disable-session-crashed-bubble --disable-features=Translate \
    --overscroll-history-navigation=0 --password-store=basic \
    --check-for-update-interval=31536000
  sleep 5
done
