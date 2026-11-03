#!/usr/bin/env bash
# Управление сервером TWM Market на VPS. Ставится в /usr/local/bin/twm.
#
#   sudo twm status         — состояние службы и версия
#   sudo twm logs           — журнал сервера (Ctrl+C — выход)
#   sudo twm restart        — перезапуск после правки /etc/twm/twm.env
#   sudo twm update         — скачать свежую сборку с GitHub и перейти на неё
#   sudo twm rollback       — вернуться на предыдущую сборку
#   sudo twm backup         — копия базы и загруженных файлов в /var/backups/twm
#                             (и зашифрованная — в Object Storage, если настроено)
#   sudo twm setup-offsite  — настроить копии вне сервера (Yandex Object Storage)
#   sudo twm offsite-list   — список копий в хранилище
#   sudo twm backup-passphrase — показать пароль шифрования копий (сохраните его вне сервера)
#   sudo twm admin-create --login ЛОГИН --email EMAIL
#   sudo twm reset-2fa --login ЛОГИН
#   sudo twm mail-test ВАШ@EMAIL — отправить тестовое письмо по настройкам почты
#   sudo twm set-domain api.example.ru — перейти на свой домен (старый адрес продолжит работать)
set -euo pipefail

REPO="TWMandem/TWM-Market"
BUNDLE_URL="https://github.com/${REPO}/releases/download/server-latest/twm-server-linux-x64.tar.gz"
ENV_FILE=/etc/twm/twm.env
ROOT=/opt/twm
SERVICE=twm-api

fail() { printf '\033[1;31mОшибка: %s\033[0m\n' "$*" >&2; exit 1; }
need_root() { [ "$(id -u)" -eq 0 ] || fail "нужны права администратора: sudo twm $*"; }
# Значение настройки из env-файла (без кавычек).
env_value() { grep "^$1=" "$ENV_FILE" 2>/dev/null | tail -n 1 | cut -d= -f2- | sed 's/^"//; s/"$//'; }

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

    # Копия вне сервера: шифруем и загружаем в Object Storage.
    if grep -q '^S3_BUCKET=.' "$ENV_FILE"; then
      pass="$(env_value BACKUP_PASSPHRASE)"
      [ -n "$pass" ] || fail "в $ENV_FILE нет BACKUP_PASSPHRASE — без шифрования копия в хранилище не загружается"
      out="$(mktemp -d)"
      for f in "db-$stamp.dump" "uploads-$stamp.tar.gz"; do
        BACKUP_PASSPHRASE="$pass" openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt \
          -pass env:BACKUP_PASSPHRASE -in "$dir/$f" -out "$out/$f.enc"
      done
      chown -R twm "$out"
      if run_cli offsite-backup "$out"/*.enc; then
        echo "Зашифрованная копия загружена в хранилище"
      else
        rm -rf "$out"
        fail "копия вне сервера не загружена — проверьте: sudo twm offsite-list"
      fi
      rm -rf "$out"
    fi
    ;;
  setup-offsite)
    need_root setup-offsite
    echo "Копии вне сервера: Yandex Object Storage (инструкция — deploy/README.md)."
    read -r -p "Имя бакета: " bucket
    read -r -p "Идентификатор статического ключа: " key_id
    read -r -s -p "Секретный ключ (при вводе не отображается): " secret
    echo
    [ -n "$bucket" ] && [ -n "$key_id" ] && [ -n "$secret" ] || fail "нужны все три значения"
    sed -i '/^S3_BUCKET=/d;/^S3_KEY_ID=/d;/^S3_SECRET=/d' "$ENV_FILE"
    {
      printf '\n# Копии вне сервера (sudo twm setup-offsite)\n'
      printf 'S3_BUCKET=%s\n' "$bucket"
      printf 'S3_KEY_ID=%s\n' "$key_id"
      printf 'S3_SECRET="%s"\n' "$secret"
    } >>"$ENV_FILE"
    if [ -z "$(env_value BACKUP_PASSPHRASE)" ]; then
      printf 'BACKUP_PASSPHRASE=%s\n' "$(openssl rand -hex 24)" >>"$ENV_FILE"
      echo "Создан пароль шифрования копий."
    fi
    run_cli offsite-backup --check || fail "хранилище недоступно — проверьте имя бакета, ключ и права сервисного аккаунта"
    echo "Готово. Каждую ночь копия будет шифроваться и загружаться в хранилище (хранится 30 дней)."
    echo "ВАЖНО: сохраните пароль шифрования вне сервера (менеджер паролей): sudo twm backup-passphrase"
    echo "Без него копию из хранилища не расшифровать."
    ;;
  offsite-list)
    need_root offsite-list
    run_cli offsite-backup --list
    ;;
  backup-passphrase)
    need_root backup-passphrase
    pass="$(env_value BACKUP_PASSPHRASE)"
    [ -n "$pass" ] || fail "пароль не задан — сначала: sudo twm setup-offsite"
    echo "$pass"
    ;;
  mail-test)
    need_root mail-test
    run_cli mail-test "$@"
    ;;
  set-domain)
    need_root set-domain
    new="${1:-}"
    new="${new,,}"
    [[ "$new" =~ ^[a-z0-9.-]+\.[a-z]{2,}$ ]] || fail "укажите домен: sudo twm set-domain api.example.ru"
    old="$(grep '^PUBLIC_DOMAIN=' "$ENV_FILE" | cut -d= -f2- | tr -d '"' || true)"
    resolved="$(getent ahostsv4 "$new" | awk 'NR==1 {print $1}' || true)"
    [ -n "$resolved" ] || fail "домен $new пока не находится в DNS. Проверьте A-запись и подождите (до нескольких часов)"
    ip="$(curl -fsS4 --max-time 10 https://api.ipify.org 2>/dev/null || true)"
    if [ -n "$ip" ] && [ "$resolved" != "$ip" ]; then
      fail "домен $new указывает на $resolved, а у этого сервера адрес $ip. Исправьте A-запись"
    fi
    # Старый адрес оставляем рядом с новым: уже установленные приложения продолжат работать.
    names="$new"
    if [ -n "$old" ] && [ "$old" != "$new" ]; then names="$new $old"; fi
    sed "s/__DOMAIN__/${names}/g" "$ROOT/current/deploy/nginx.conf" >/etc/nginx/sites-available/twm
    nginx -t
    systemctl reload nginx
    cert_args=()
    for name in $names; do cert_args+=(-d "$name"); done
    certbot --nginx --cert-name twm "${cert_args[@]}" --non-interactive --agree-tos \
      --register-unsafely-without-email --redirect --expand
    sed -i "s/^PUBLIC_DOMAIN=.*/PUBLIC_DOMAIN=${new}/" "$ENV_FILE"
    if curl -fsS "https://${new}/health"; then
      echo
      echo "Готово: сервер отвечает на https://${new} (и по-прежнему на ${old:-—})"
    else
      fail "сертификат получен, но https://${new}/health не ответил. Журнал: sudo twm logs"
    fi
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
    sed -n '2,/^set -euo/p' "$0" | grep '^#' | sed 's/^# \{0,1\}//'
    ;;
esac
