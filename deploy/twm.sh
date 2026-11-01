#!/usr/bin/env bash
# Управление сервером TWM Market на VPS. Ставится в /usr/local/bin/twm.
#
#   sudo twm status         — состояние службы и версия
#   sudo twm logs           — журнал сервера (Ctrl+C — выход)
#   sudo twm restart        — перезапуск после правки /etc/twm/twm.env
#   sudo twm update         — скачать свежую сборку с GitHub и перейти на неё
#   sudo twm rollback       — вернуться на предыдущую сборку
#   sudo twm backup         — копия базы и загруженных файлов в /var/backups/twm
#   sudo twm admin-create --login ЛОГИН --email EMAIL
#   sudo twm reset-2fa --login ЛОГИН
set -euo pipefail

REPO="TWMandem/TWM-Market"
BUNDLE_URL="https://github.com/${REPO}/releases/download/server-latest/twm-server-linux-x64.tar.gz"
ENV_FILE=/etc/twm/twm.env
ROOT=/opt/twm
SERVICE=twm-api

fail() { printf '\033[1;31mОшибка: %s\033[0m\n' "$*" >&2; exit 1; }
need_root() { [ "$(id -u)" -eq 0 ] || fail "нужны права администратора: sudo twm $*"; }

healthy() {
  for _ in $(seq 1 30); do
    if curl -fsS http://127.0.0.1:3000/health >/dev/null 2>&1; then return 0; fi
    sleep 1
  done
  return 1
}

# Запуск команды сервера (CLI) от имени пользователя twm с настройками из env-файла.
run_cli() {
  local script="$1"
  shift
  cd "$ROOT/current/app"
  runuser -u twm -- "$ROOT/current/bin/node" --env-file="$ENV_FILE" "dist/cli/${script}.js" "$@"
}

install_bundle() {
  local file="$1" tmp version target previous
  tmp="$(mktemp -d)"
  tar -xzf "$file" -C "$tmp"
  [ -x "$tmp/twm-server/bin/node" ] || fail "в сборке нет bin/node"
  version="$(cat "$tmp/twm-server/VERSION")"
  target="$ROOT/releases/$version"
  rm -rf "$target"
  mv "$tmp/twm-server" "$target"
  rm -rf "$tmp"
  chown -R root:root "$target"
  # Служба работает от пользователя twm: файлы сборки должны быть читаемы.
  chmod -R u=rwX,go=rX "$target"
  chmod 755 "$target/bin/node" "$target/deploy/twm.sh"

  install -m 755 "$target/deploy/twm.sh" /usr/local/bin/twm
  install -m 644 "$target/deploy/twm-api.service" "/etc/systemd/system/${SERVICE}.service"
  systemctl daemon-reload

  previous="$(readlink -f "$ROOT/current" 2>/dev/null || true)"
  ln -sfn "$target" "$ROOT/current.new"
  mv -T "$ROOT/current.new" "$ROOT/current"
  systemctl enable "$SERVICE" >/dev/null 2>&1
  systemctl restart "$SERVICE"

  if healthy; then
    echo "Сервер запущен, версия ${version}"
  else
    if [ -n "$previous" ] && [ "$previous" != "$target" ] && [ -d "$previous" ]; then
      echo "Новая версия не запустилась — возвращаю предыдущую" >&2
      ln -sfn "$previous" "$ROOT/current.new"
      mv -T "$ROOT/current.new" "$ROOT/current"
      systemctl restart "$SERVICE"
    fi
    fail "сервер не ответил. Журнал: sudo twm logs"
  fi

  # Храним три последние сборки — для отката.
  ls -1dt "$ROOT"/releases/*/ 2>/dev/null | tail -n +4 | xargs -r rm -rf
}

cmd="${1:-help}"
shift || true

case "$cmd" in
  status)
    systemctl --no-pager status "$SERVICE" | head -n 5 || true
    echo "Версия: $(cat "$ROOT/current/VERSION" 2>/dev/null || echo '—')"
    curl -fsS http://127.0.0.1:3000/health && echo
    ;;
  logs)
    journalctl -u "$SERVICE" -n 200 -f
    ;;
  restart)
    need_root restart
    systemctl restart "$SERVICE"
    healthy && echo "Сервер перезапущен" || fail "сервер не ответил. Журнал: sudo twm logs"
    ;;
  install-bundle)
    need_root install-bundle
    [ -f "${1:-}" ] || fail "укажите файл сборки"
    install_bundle "$1"
    ;;
  update)
    need_root update
    tmp="$(mktemp -d)"
    trap 'rm -rf "$tmp"' EXIT
    echo "Скачиваю сборку…"
    curl -fL --retry 3 -o "$tmp/bundle.tar.gz" "$BUNDLE_URL"
    curl -fsL --retry 3 -o "$tmp/bundle.sha256" "${BUNDLE_URL}.sha256"
    (cd "$tmp" && echo "$(cut -d' ' -f1 bundle.sha256)  bundle.tar.gz" | sha256sum -c --quiet) || fail "контрольная сумма не совпала"
    twm backup
    install_bundle "$tmp/bundle.tar.gz"
    ;;
  rollback)
    need_root rollback
    current="$(readlink -f "$ROOT/current")"
    previous="$(ls -1dt "$ROOT"/releases/*/ | sed 's:/$::' | grep -vx "$current" | head -n 1 || true)"
    [ -n "$previous" ] || fail "нет предыдущей сборки"
    ln -sfn "$previous" "$ROOT/current.new"
    mv -T "$ROOT/current.new" "$ROOT/current"
    systemctl restart "$SERVICE"
    healthy && echo "Возвращена версия $(cat "$ROOT/current/VERSION")" || fail "сервер не ответил"
    echo "Внимание: изменения базы данных (миграции) при откате не отменяются."
    ;;
  backup)
    need_root backup
    stamp="$(date +%Y%m%d-%H%M%S)"
    dir=/var/backups/twm
    install -d -m 700 "$dir"
    runuser -u postgres -- pg_dump -Fc twm >"$dir/db-$stamp.dump"
    tar -czf "$dir/uploads-$stamp.tar.gz" -C /var/lib/twm uploads
    find "$dir" -type f -mtime +14 -delete
    echo "Копия сохранена: $dir/db-$stamp.dump, $dir/uploads-$stamp.tar.gz"
    ;;
  admin-create)
    need_root admin-create
    run_cli create-admin "$@"
    ;;
  reset-2fa)
    need_root reset-2fa
    run_cli reset-2fa "$@"
    ;;
  version)
    cat "$ROOT/current/VERSION"
    ;;
  *)
    sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'
    ;;
esac
