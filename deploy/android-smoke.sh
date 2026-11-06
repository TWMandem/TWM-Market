#!/usr/bin/env bash
# Проверка на эмуляторе Android: приложение ставится и запускается без падения.
#   $1 — APK (с библиотекой для x86_64).
# Запускается внутри reactivecircus/android-emulator-runner.
set -uo pipefail
apk="$1"
pkg=ru.twmmarket.app

# Эмулятор мог только что загрузиться: ждём, пока система будет готова.
for _ in $(seq 1 60); do
  [ "$(adb shell getprop sys.boot_completed | tr -d '\r')" = "1" ] && break
  sleep 2
done
adb install -r "$apk" || exit 1
adb logcat -c
activity="$(adb shell cmd package resolve-activity --brief -c android.intent.category.LAUNCHER "$pkg" | tr -d '\r' | tail -n 1)"
echo "Главный экран приложения: $activity"
# Запуск; если система ещё занята и приложение не поднялось — ещё попытка (до трёх).
pid=""
for attempt in 1 2 3; do
  adb shell am start -W -n "$activity" || true
  for _ in $(seq 1 15); do
    pid="$(adb shell pidof "$pkg" | tr -d '\r')"
    [ -n "$pid" ] && break
    sleep 2
  done
  [ -n "$pid" ] && break
  echo "Попытка $attempt: приложение не поднялось, повторяю"
done
# Даём приложению открыть интерфейс.
sleep 25
adb logcat -d > "${RUNNER_TEMP:-/tmp}/logcat.txt"
if grep -q "FATAL EXCEPTION" "${RUNNER_TEMP:-/tmp}/logcat.txt"; then
  echo "Приложение упало при запуске:"
  grep -A40 "FATAL EXCEPTION" "${RUNNER_TEMP:-/tmp}/logcat.txt" | head -80
  exit 1
fi
pid="$(adb shell pidof "$pkg" | tr -d '\r')"
if [ -z "$pid" ]; then
  echo "Приложение не запущено. Конец журнала:"
  grep -iE "$pkg|AndroidRuntime|ActivityManager|ActivityTaskManager" "${RUNNER_TEMP:-/tmp}/logcat.txt" | tail -n 120
  exit 1
fi
adb shell screencap -p /sdcard/start.png && adb pull /sdcard/start.png "${RUNNER_TEMP:-/tmp}/android-start.png" > /dev/null
echo "Приложение запущено (pid $pid), падений нет."
