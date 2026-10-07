#!/usr/bin/env bash
# Установка Limoninior на чистый Ubuntu 22.04/24.04 (или Debian 12).
# Запуск из папки с проектом:  sudo bash deploy/install.sh chat.example.ru you@gmail.com
set -euo pipefail

DOMAIN="${1:-}"
ADMIN_EMAIL="${2:-}"
APP_DIR=/opt/limoninior
SRC_DIR="$(cd "$(dirname "$0")/.." && pwd)"

if [[ $EUID -ne 0 ]]; then echo "Запустите через sudo"; exit 1; fi
if [[ -z "$DOMAIN" ]]; then
  echo "Использование: sudo bash deploy/install.sh <домен> [ваш-google-email]"
  exit 1
fi

echo "==> Пакеты"
apt-get update -y
apt-get install -y curl ca-certificates gnupg rsync ufw debian-keyring debian-archive-keyring apt-transport-https

need_node=1
if command -v node >/dev/null; then
  v=$(node -e 'const [a,b]=process.versions.node.split(".").map(Number);console.log(a>22||(a===22&&b>=13)?1:0)' 2>/dev/null || echo 0)
  [[ "$v" == "1" ]] && need_node=0
fi
if [[ $need_node == 1 ]]; then
  echo "==> Node.js 22"
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

if ! command -v caddy >/dev/null; then
  echo "==> Caddy (HTTPS)"
  if ! apt-get install -y caddy 2>/dev/null; then
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
    apt-get update -y && apt-get install -y caddy
  fi
fi

echo "==> Пользователь и файлы"
id limoninior >/dev/null 2>&1 || useradd --system --home "$APP_DIR" --shell /usr/sbin/nologin limoninior
mkdir -p "$APP_DIR/data"
rsync -a --delete --exclude node_modules --exclude data --exclude .env --exclude .git "$SRC_DIR/" "$APP_DIR/"
cd "$APP_DIR"
npm ci --omit=dev --no-audit --no-fund

if [[ ! -f .env ]]; then
  echo "==> Создаю .env"
  SECRET=$(node -e "import('./server/totp.js').then(m=>console.log(m.generateSecret()))")
  cat > .env <<EOF
NODE_ENV=production
APP_ORIGIN=https://$DOMAIN
GOOGLE_CLIENT_ID=
ADMIN_EMAILS=$ADMIN_EMAIL
ADMIN_TOTP_SECRET=$SECRET
ADMIN_SESSION_MINUTES=15
PORT=3000
HOST=127.0.0.1
DATA_DIR=data
TRUST_PROXY=1
EOF
  NEW_SECRET=$SECRET
fi
chown -R limoninior:limoninior "$APP_DIR/data"
chown root:limoninior .env && chmod 640 .env
chmod 700 "$APP_DIR/data"

echo "==> systemd"
cp deploy/limoninior.service /etc/systemd/system/limoninior.service
systemctl daemon-reload
systemctl enable limoninior

echo "==> Caddy"
sed "s/chat.example.ru/$DOMAIN/" deploy/Caddyfile > /etc/caddy/Caddyfile
systemctl enable caddy
systemctl restart caddy

echo "==> Файрвол"
ufw allow OpenSSH >/dev/null
ufw allow 80/tcp >/dev/null
ufw allow 443 >/dev/null
ufw --force enable >/dev/null

if grep -q '^GOOGLE_CLIENT_ID=$' .env; then
  echo
  echo "!!! Осталось вписать GOOGLE_CLIENT_ID в $APP_DIR/.env, затем: sudo systemctl restart limoninior"
else
  systemctl restart limoninior
fi

if [[ -n "${NEW_SECRET:-}" ]]; then
  echo
  echo "================ АДМИНКА ================"
  echo "Добавьте этот ключ в Google Authenticator / Яндекс Ключ / Aegis:"
  echo "    $NEW_SECRET"
  echo "или ссылкой: otpauth://totp/Limoninior:${ADMIN_EMAIL}?secret=${NEW_SECRET}&issuer=Limoninior"
  echo "Он показывается ОДИН раз (хранится в $APP_DIR/.env)."
  echo "========================================="
fi
echo
echo "Готово: https://$DOMAIN"
