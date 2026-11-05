#!/usr/bin/env bash
# Готовит проект Android (src-tauri/gen/android) для сборки в GitHub Actions.
# Проект создаётся заново при каждой сборке из настроек tauri.conf.json и
# tauri.android.conf.json, поэтому в репозитории его нет.
# Запускать из apps/desktop.
set -euo pipefail

# NDK уже установлен на раннерах GitHub.
export NDK_HOME="${NDK_HOME:-${ANDROID_NDK_LATEST_HOME:-}}"
if [ -z "$NDK_HOME" ]; then
  echo "Не найден Android NDK (ANDROID_NDK_LATEST_HOME)" >&2
  exit 1
fi
echo "NDK_HOME=$NDK_HOME" >> "${GITHUB_ENV:-/dev/null}"

pnpm tauri android init --ci

# Иконки для Android — свои, адаптивные (src-tauri/icons/android, make.py):
# знак вписан в безопасную зону, поэтому маска лаунчера его не обрезает.
res=src-tauri/gen/android/app/src/main/res
rm -f "$res"/mipmap-*/ic_launcher*.png "$res"/mipmap-*/ic_launcher*.webp "$res"/mipmap-anydpi-v26/ic_launcher*.xml
rm -f "$res"/values/ic_launcher_background.xml
cp -r src-tauri/icons/android/res/. "$res/"
find "$res" -name 'ic_launcher*' | sort
