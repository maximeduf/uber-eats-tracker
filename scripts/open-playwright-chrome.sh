#!/usr/bin/env bash

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROFILE_DIR="$PROJECT_ROOT/apps/scraper/.pw-user-data"
TARGET_URL="https://myprivacy.uber.com/exploreyourdata/orders"

mkdir -p "$PROFILE_DIR"

if command -v google-chrome >/dev/null 2>&1; then
  exec google-chrome --user-data-dir="$PROFILE_DIR" --profile-directory=Default "$TARGET_URL"
fi

if command -v chromium >/dev/null 2>&1; then
  exec chromium --user-data-dir="$PROFILE_DIR" --profile-directory=Default "$TARGET_URL"
fi

if command -v chromium-browser >/dev/null 2>&1; then
  exec chromium-browser --user-data-dir="$PROFILE_DIR" --profile-directory=Default "$TARGET_URL"
fi

echo "Could not find google-chrome, chromium, or chromium-browser in PATH."
echo "Install one of those browsers, then run: npm run chrome:playwright-profile to open the Uber privacy orders page."
exit 1