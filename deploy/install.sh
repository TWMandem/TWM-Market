#!/usr/bin/env bash
# Установка сервера TWM Market на чистый VPS (Ubuntu 22.04/24.04 или Debian 12, x86_64).
#
#   curl -fsSL https://github.com/TWMandem/TWM-Market/releases/download/server-latest/install.sh -o install.sh
#   sudo bash install.sh
#
# Что делает: ставит PostgreSQL и nginx из репозиториев системы, скачивает
# готовую сборку сервера (Node.js уже внутри) с GitHub, создаёт базу и секреты,
# запускает сервер как службу, получает HTTPS-сертификат Let's Encrypt
# и включает ежедневные резервные копии. Повторный запуск безопасен.
set -euo pipefail

REPO="TWMandem/TWM-Market"
BUNDLE_URL="https://github.com/${REPO}/releases/download/server-latest/twm-server-linux-x64.tar.gz"
ENV_FILE=/etc/twm/twm.env

say() { printf '\n\033[1;33m==> %s\033[0m\n' "$*"; }
fail() { printf '\n\033[1;31mОшибка: %s\033[0m\n' "$*" >&2; exit 1; }
ask() {
  # Вопросы читаются с клавиатуры, даже если скрипт пришёл через конвейер.
  local prompt="$1" default="${2:-}" answer=""
  if [ -r /dev/tty ]; then
    read -r -p "$prompt${default:+ [$default]}: " answer </dev/tty || true
  fi
  printf '%s' "${answer:-$default}"
}

[ "$(id -u)" -eq 0 ] || fail "запустите через sudo: sudo bash install.sh"
[ "$(uname -m)" = "x86_64" ] || fail "нужен сервер x86_64 (сейчас $(uname -m))"
. /etc/os-release
case "${ID}:${VERSION_ID}" in
  ubuntu:22.04|ubuntu:24.04|debian:12) ;;
  *) echo "Внимание: проверено на Ubuntu 22.04/24.04 и Debian 12, у вас ${PRETTY_NAME}. Продолжаю." ;;
esac

# ── Вопросы ──────────────────────────────────────────────────────────────────
PUBLIC_IP="$(curl -fsS4 --max-time 10 https://api.ipify.org 2>/dev/null || hostname -I | awk '{print $1}')"
DEFAULT_DOMAIN="${PUBLIC_IP//./-}.sslip.io"

if [ -f "$ENV_FILE" ] && grep -q '^PUBLIC_DOMAIN=' "$ENV_FILE"; then
  DOMAIN="$(grep '^PUBLIC_DOMAIN=' "$ENV_FILE" | cut -d= -f2- | tr -d '"')"
  echo "Сервер уже настраивался для ${DOMAIN} — обновляю установку."
else
  echo
  echo "Адрес сервера. Если своего домена нет, подойдёт бесплатный ${DEFAULT_DOMAIN}"
  echo "(он указывает на IP этого сервера). Свой домен должен уже указывать на ${PUBLIC_IP}."
  DOMAIN="$(ask "Домен" "$DEFAULT_DOMAIN")"
fi
DOMAIN="${DOMAIN,,}"
[[ "$DOMAIN" =~ ^[a-z0-9.-]+$ ]] || fail "неверный домен: $DOMAIN"
CERT_EMAIL="${CERT_EMAIL:-$(ask "Email для уведомлений Let's Encrypt о сертификате (можно пусто)" "")}"

# ── Пакеты ───────────────────────────────────────────────────────────────────
say "Устанавливаю PostgreSQL, nginx и certbot"
export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get install -y -q postgresql postgresql-contrib nginx certbot python3-certbot-nginx curl ca-certificates tar gzip openssl

# ── Пользователь и папки ─────────────────────────────────────────────────────
id twm >/dev/null 2>&1 || useradd --system --home /opt/twm --shell /usr/sbin/nologin twm
install -d -o root -g root -m 755 /opt/twm /opt/twm/releases
install -d -o twm -g twm -m 755 /var/lib/twm /var/lib/twm/uploads
install -d -o root -g root -m 700 /var/backups/twm
install -d -o root -g twm -m 750 /etc/twm

# ── База и секреты ───────────────────────────────────────────────────────────
if [ ! -f "$ENV_FILE" ]; then
  say "Создаю базу данных и секреты"
  DB_PASS="$(openssl rand -hex 24)"
  runuser -u postgres -- psql -v ON_ERROR_STOP=1 -q <<SQL
DO \$\$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'twm') THEN
    CREATE ROLE twm LOGIN PASSWORD '${DB_PASS}';
  ELSE
    ALTER ROLE twm PASSWORD '${DB_PASS}';
  END IF;
END \$\$;
SQL
  runuser -u postgres -- psql -tAc "SELECT 1 FROM pg_database WHERE datname = 'twm'" | grep -q 1 \
    || runuser -u postgres -- createdb -O twm twm

  umask 027
  cat >"$ENV_FILE" <<ENV
# Настройки сервера TWM Market. После правки: sudo twm restart
NODE_ENV=production
HOST=127.0.0.1
PORT=3000
TRUST_PROXY=true
PUBLIC_DOMAIN=${DOMAIN}
DATABASE_URL=postgres://twm:${DB_PASS}@127.0.0.1:5432/twm
JWT_SECRET=$(openssl rand -hex 32)
CODE_SECRET=$(openssl rand -hex 32)
UPLOAD_DIR=/var/lib/twm/uploads
MAX_UPLOAD_MB=10

# Почта для кодов подтверждения. Пока console — коды пишутся в журнал (sudo twm logs).
# Для Яндекса: включите пароли приложений в настройках почты и укажите:
#   MAIL_TRANSPORT=smtp
#   SMTP_HOST=smtp.yandex.ru
#   SMTP_PORT=465
#   SMTP_SECURE=true
#   SMTP_USER=ваш_ящик@yandex.ru
#   SMTP_PASS="пароль приложения"
#   MAIL_FROM="TWM Market <ваш_ящик@yandex.ru>"
MAIL_TRANSPORT=console
ENV
  chown root:twm "$ENV_FILE"
  chmod 640 "$ENV_FILE"
fi

# ── Сборка сервера ───────────────────────────────────────────────────────────
say "Скачиваю сборку сервера с GitHub"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
curl -fL --retry 3 -o "$TMP/bundle.tar.gz" "$BUNDLE_URL" || fail "не удалось скачать $BUNDLE_URL"
curl -fsL --retry 3 -o "$TMP/bundle.sha256" "${BUNDLE_URL}.sha256" || fail "не удалось скачать контрольную сумму"
(cd "$TMP" && echo "$(cut -d' ' -f1 bundle.sha256)  bundle.tar.gz" | sha256sum -c --quiet) || fail "контрольная сумма не совпала"
tar -xzf "$TMP/bundle.tar.gz" -C "$TMP"
install -m 755 "$TMP/twm-server/deploy/twm.sh" /usr/local/bin/twm

# Службу и nginx ставит та же команда, что и обновление.
/usr/local/bin/twm install-bundle "$TMP/bundle.tar.gz"

# ── nginx и HTTPS ────────────────────────────────────────────────────────────
say "Настраиваю nginx для ${DOMAIN}"
sed "s/__DOMAIN__/${DOMAIN}/g" "$TMP/twm-server/deploy/nginx.conf" >/etc/nginx/sites-available/twm
ln -sf /etc/nginx/sites-available/twm /etc/nginx/sites-enabled/twm
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx

if [ ! -d "/etc/letsencrypt/live/${DOMAIN}" ]; then
  say "Получаю сертификат HTTPS (Let's Encrypt)"
  if [ -n "$CERT_EMAIL" ]; then
    certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m "$CERT_EMAIL" --redirect
  else
    certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos --register-unsafely-without-email --redirect
  fi
fi

# ── Резервные копии ──────────────────────────────────────────────────────────
cat >/etc/cron.d/twm-backup <<'CRON'
# Ежедневная копия базы и загруженных файлов, хранится 14 дней.
30 4 * * * root /usr/local/bin/twm backup >/var/log/twm-backup.log 2>&1
CRON

# ── Проверка ─────────────────────────────────────────────────────────────────
say "Проверяю сервер"
for _ in $(seq 1 20); do
  if curl -fsS "https://${DOMAIN}/health" >/dev/null 2>&1; then break; fi
  sleep 2
done
if curl -fsS "https://${DOMAIN}/health"; then
  echo
  say "Готово! Сервер работает: https://${DOMAIN}"
  echo "Дальше:"
  echo "  1. Создайте администратора:   sudo twm admin-create --login ВАШ_ЛОГИН --email ВАШ@EMAIL"
  echo "  2. Настройте почту в ${ENV_FILE} и выполните: sudo twm restart"
  echo "  3. Пришлите адрес https://${DOMAIN} — он будет вшит в приложение."
  echo "Команды: sudo twm status | logs | update | backup | restart"
else
  fail "сервер не ответил по https://${DOMAIN}/health. Посмотрите журнал: sudo twm logs"
fi
