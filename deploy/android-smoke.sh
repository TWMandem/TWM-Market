#!/usr/bin/env bash
# Проверка на эмуляторе Android: приложение ставится и запускается без падения.
#   $1 — APK (с библиотекой для x86_64).
# Запускается внутри reactivecircus/android-emulator-runner.
set -uo pipefail
apk="$1"
pkg=ru.twmmarket.app

adb install -r "$apk" || exit 1
adb logcat -c
adb shell monkey -p "$pkg" -c android.intent.category.LAUNCHER 1 > /dev/null
# Даём приложению запуститься и открыть интерфейс.
sleep 30
adb logcat -d > "${RUNNER_TEMP:-/tmp}/logcat.txt"
if grep -q "FATAL EXCEPTION" "${RUNNER_TEMP:-/tmp}/logcat.txt"; then
  echo "Приложение упало при запуске:"
  grep -A40 "FATAL EXCEPTION" "${RUNNER_TEMP:-/tmp}/logcat.txt" | head -80
  exit 1
fi
pid="$(adb shell pidof "$pkg" | tr -d '\r')"
if [ -z "$pid" ]; then
  echo "Приложение не запущено. Конец журнала:"
  tail -n 120 "${RUNNER_TEMP:-/tmp}/logcat.txt"
  exit 1
fi
adb shell screencap -p /sdcard/start.png && adb pull /sdcard/start.png "${RUNNER_TEMP:-/tmp}/android-start.png" > /dev/null
echo "Приложение запущено (pid $pid), падений нет."
