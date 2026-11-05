#!/usr/bin/env bash
# Выравнивает и подписывает собранный APK.
#   ANDROID_KEYSTORE_FILE, ANDROID_KEYSTORE_PASSWORD, ANDROID_KEY_ALIAS, ANDROID_KEY_PASSWORD
#   $1 — куда положить подписанный APK.
# Запускать из apps/desktop после «tauri android build --apk».
set -euo pipefail
out="$1"

unsigned="$(ls src-tauri/gen/android/app/build/outputs/apk/universal/release/*-unsigned.apk | head -n 1)"
[ -f "$unsigned" ] || { echo "Не найден собранный APK" >&2; exit 1; }

tools="$ANDROID_HOME/build-tools/$(ls "$ANDROID_HOME/build-tools" | sort -V | tail -n 1)"
"$tools/zipalign" -f -p 4 "$unsigned" "$out.aligned"
"$tools/apksigner" sign \
  --ks "$ANDROID_KEYSTORE_FILE" --ks-pass env:ANDROID_KEYSTORE_PASSWORD \
  --ks-key-alias "$ANDROID_KEY_ALIAS" --key-pass env:ANDROID_KEY_PASSWORD \
  --out "$out" "$out.aligned"
rm -f "$out.aligned"
"$tools/apksigner" verify --print-certs "$out"
ls -l "$out"
