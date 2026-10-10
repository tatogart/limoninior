#!/usr/bin/env bash
# Установка / обновление Limoninior на Ubuntu 22.04/24.04 (или Debian 12).
# Первый запуск из папки с проектом:  sudo bash deploy/install.sh chat.example.ru you@gmail.com
# Повторные запуски (и автообновление) можно делать без аргументов — домен запоминается.
set -euo pipefail

main() {
APP_DIR=/opt/limoninior
CONF_DIR=/etc/limoninior
SRC_DIR="$(cd "$(dirname "$0")/.." && pwd)"
[[ -f $CONF_DIR/deploy.conf ]] && source $CONF_DIR/deploy.conf
DOMAIN="${1:-${DOMAIN:-}}"
ADMIN_EMAIL="${2:-}"

if [[ $EUID -ne 0 ]]; then echo "Запустите через sudo"; exit 1; fi
if [[ -z "$DOMAIN" ]]; then
  echo "Использование: sudo bash deploy/install.sh <домен> [ваш-google-email]"
  exit 1
fi

need_node=1
if command -v node >/dev/null; then
  v=$(node -e 'const [a,b]=process.versions.node.split(".").map(Number);console.log(a>22||(a===22&&b>=13)?1:0)' 2>/dev/null || echo 0)
  [[ "$v" == "1" ]] && need_node=0
fi

if [[ $need_node == 1 ]] || ! command -v caddy >/dev/null || ! command -v rsync >/dev/null || ! command -v ufw >/dev/null || ! command -v turnserver >/dev/null; then
  echo "==> Пакеты"
  apt-get update -y
  DEBIAN_FRONTEND=noninteractive apt-get install -y curl ca-certificates gnupg rsync ufw git openssl coturn debian-keyring debian-archive-keyring apt-transport-https
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
fi

echo "==> Файлы"
id limoninior >/dev/null 2>&1 || useradd --system --home "$APP_DIR" --shell /usr/sbin/nologin limoninior
mkdir -p "$APP_DIR/data" "$CONF_DIR"
rsync -a --delete --exclude node_modules --exclude data --exclude .env --exclude .git --exclude VERSION --exclude .deployed-rev --exclude .lock-hash "$SRC_DIR/" "$APP_DIR/"
if git -C "$SRC_DIR" rev-parse HEAD >/dev/null 2>&1; then
  git -C "$SRC_DIR" log -1 --format='%h от %cd' --date=format:'%d.%m.%Y %H:%M' > "$APP_DIR/VERSION"
  BRANCH=$(git -C "$SRC_DIR" rev-parse --abbrev-ref HEAD)
fi
cd "$APP_DIR"
# Зависимости ставим заново только если они поменялись (и сначала из локального кэша) —
# так обновление не ломается, когда npm временно недоступен.
lock_hash=$(sha256sum package-lock.json | cut -d' ' -f1)
if [[ ! -d node_modules || "$(cat .lock-hash 2>/dev/null)" != "$lock_hash" ]]; then
  npm ci --omit=dev --no-audit --no-fund --loglevel=error --prefer-offline || npm ci --omit=dev --no-audit --no-fund --loglevel=error
  echo "$lock_hash" > .lock-hash
fi

cat > $CONF_DIR/deploy.conf <<EOF
DOMAIN=$DOMAIN
SRC_DIR=$SRC_DIR
BRANCH=${BRANCH:-main}
EOF

if [[ ! -f .env ]]; then
  echo "==> Создаю .env"
  SECRET=$(node -e "import('./server/totp.js').then(m=>console.log(m.generateSecret()))")
  cat > .env <<EOF
NODE_ENV=production
APP_ORIGIN=https://$DOMAIN
GOOGLE_CLIENT_ID=
ADMIN_EMAILS=$ADMIN_EMAIL
ADMIN_USERNAMES=
ADMIN_TOTP_SECRET=$SECRET
ADMIN_SESSION_MINUTES=15
PORT=3000
HOST=127.0.0.1
DATA_DIR=data
TRUST_PROXY=1
EOF
  NEW_SECRET=$SECRET
fi
# Google Client ID из deploy/google-client-id.txt, если в .env он пустой.
if [[ -f deploy/google-client-id.txt ]] && grep -q '^GOOGLE_CLIENT_ID=$' .env; then
  CID=$(tr -d '[:space:]' < deploy/google-client-id.txt)
  if [[ "$CID" =~ ^[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com$ ]]; then
    sed -i "s|^GOOGLE_CLIENT_ID=$|GOOGLE_CLIENT_ID=$CID|" .env
    echo "==> Google Client ID подставлен"
  fi
fi
# Админы с входом по паролю из deploy/admin-usernames.txt (через запятую).
if [[ -f deploy/admin-usernames.txt ]]; then
  AU=$(tr -d '[:space:]' < deploy/admin-usernames.txt)
  if [[ "$AU" =~ ^[A-Za-z0-9_,]*$ ]]; then
    grep -q '^ADMIN_USERNAMES=' .env || echo 'ADMIN_USERNAMES=' >> .env
    sed -i "s|^ADMIN_USERNAMES=.*|ADMIN_USERNAMES=$AU|" .env
  fi
fi
# Secret for TURN (relay for calls behind NAT).
grep -q '^TURN_SECRET=' .env || echo "TURN_SECRET=$(openssl rand -hex 24)" >> .env
chown -R limoninior:limoninior "$APP_DIR/data"
chown root:limoninior .env && chmod 640 .env
chmod 700 "$APP_DIR/data"

echo "==> systemd"
cp deploy/limoninior.service /etc/systemd/system/limoninior.service
cp deploy/limoninior-update.service deploy/limoninior-update.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable limoninior >/dev/null
systemctl enable --now limoninior-update.timer >/dev/null

echo "==> Caddy"
sed "s/chat.example.ru/$DOMAIN/" deploy/Caddyfile > /etc/caddy/Caddyfile.new
if ! cmp -s /etc/caddy/Caddyfile.new /etc/caddy/Caddyfile || ! systemctl is-active --quiet caddy; then
  mv /etc/caddy/Caddyfile.new /etc/caddy/Caddyfile
  systemctl enable caddy >/dev/null
  systemctl restart caddy
else
  rm -f /etc/caddy/Caddyfile.new
fi

echo "==> TURN (звонки)"
TURN_SECRET=$(grep '^TURN_SECRET=' .env | cut -d= -f2)
PUBLIC_IP=$(hostname -I | awk '{print $1}')
cat > /etc/turnserver.conf.new <<TURNCONF
listening-port=3478
fingerprint
use-auth-secret
static-auth-secret=$TURN_SECRET
realm=$DOMAIN
min-port=49160
max-port=49200
external-ip=$PUBLIC_IP
no-cli
no-tls
no-dtls
no-multicast-peers
no-loopback-peers
denied-peer-ip=10.0.0.0-10.255.255.255
denied-peer-ip=172.16.0.0-172.31.255.255
denied-peer-ip=192.168.0.0-192.168.255.255
denied-peer-ip=127.0.0.0-127.255.255.255
user-quota=12
total-quota=200
TURNCONF
[[ -f /etc/default/coturn ]] && sed -i 's/^#\?TURNSERVER_ENABLED=.*/TURNSERVER_ENABLED=1/' /etc/default/coturn
if ! cmp -s /etc/turnserver.conf.new /etc/turnserver.conf || ! systemctl is-active --quiet coturn; then
  mv /etc/turnserver.conf.new /etc/turnserver.conf
  systemctl enable coturn >/dev/null 2>&1 || true
  systemctl restart coturn || echo "!!! coturn не запустился — звонки будут работать только без NAT"
else
  rm -f /etc/turnserver.conf.new
fi

echo "==> Файрвол"
ufw allow OpenSSH >/dev/null
ufw allow 80/tcp >/dev/null
ufw allow 443 >/dev/null
ufw allow 3478 >/dev/null
ufw allow 49160:49200/udp >/dev/null
ufw status | grep -q 'Status: active' || ufw --force enable >/dev/null

systemctl restart limoninior

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
# Отметка «эта версия установлена» — автообновление повторит попытку, если установка упала.
git -C "$SRC_DIR" rev-parse HEAD > "$APP_DIR/.deployed-rev" 2>/dev/null || true
echo "Готово: https://$DOMAIN  (версия $(cat "$APP_DIR/VERSION" 2>/dev/null || echo dev))"
echo "Автообновление включено: сервер сам подтягивает новые версии с GitHub каждые 2 минуты."
}

main "$@"
