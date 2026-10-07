#!/usr/bin/env bash
# Автообновление Limoninior. Запускается systemd-таймером (limoninior-update.timer) от root.
# Обновляет, если на GitHub появились новые коммиты или админ нажал «Обновить сейчас».
set -uo pipefail

main() {
  local conf=/etc/limoninior/deploy.conf
  local data=/opt/limoninior/data
  local flag=$data/update-request
  local status=$data/update-status.json
  [[ -f $conf ]] || exit 0
  source "$conf"
  exec 9>/run/limoninior-update.lock
  flock -n 9 || exit 0

  write_status() { # ok message
    printf '{"at":%s,"ok":%s,"message":"%s","version":"%s"}\n' "$(date +%s%3N)" "$1" "$2" \
      "$(cat /opt/limoninior/VERSION 2>/dev/null)" > "$status.tmp" && mv "$status.tmp" "$status"
    chown limoninior:limoninior "$status" 2>/dev/null || true
  }

  cd "$SRC_DIR" || { write_status false "нет папки $SRC_DIR"; exit 1; }
  if ! git fetch -q origin "$BRANCH" 2>/dev/null; then
    write_status false "не удалось связаться с GitHub"
    exit 0
  fi
  local local_rev remote_rev
  local_rev=$(git rev-parse HEAD)
  remote_rev=$(git rev-parse "origin/$BRANCH")
  if [[ "$local_rev" == "$remote_rev" && ! -f $flag ]]; then
    write_status true "актуальная версия"
    exit 0
  fi

  rm -f "$flag"
  git reset -q --hard "origin/$BRANCH"
  if bash deploy/install.sh > /var/log/limoninior-update.log 2>&1; then
    write_status true "обновлено"
  else
    write_status false "ошибка обновления, см. /var/log/limoninior-update.log"
  fi
}

main "$@"
