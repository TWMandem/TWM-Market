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
# Иконки приложения для Android из общей картинки.
pnpm tauri icon src-tauri/icons/icon.png
