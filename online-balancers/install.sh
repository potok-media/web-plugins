#!/usr/bin/env bash
set -euo pipefail

readonly REPOSITORY_URL="https://github.com/potok-media/web-plugins.git"
readonly INSTALL_ROOT="${XDG_DATA_HOME:-${HOME}/.local/share}/potok-web-plugins"
readonly SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" 2>/dev/null && pwd || true)"

log() {
  printf '[online-balancers] %s\n' "$1"
}

install_docker() {
  if command -v docker >/dev/null 2>&1; then
    return
  fi

  case "$(uname -s)" in
    Linux)
      log "Docker не найден — устанавливаю Docker Engine официальным install-скриптом."
      local installer
      installer="$(mktemp)"
      curl -fsSL https://get.docker.com -o "${installer}"
      if [ "$(id -u)" -eq 0 ]; then
        sh "${installer}"
      else
        sudo sh "${installer}"
      fi
      rm -f -- "${installer}"
      ;;
    Darwin)
      if ! command -v brew >/dev/null 2>&1; then
        log "Для автоматической установки Docker Desktop на macOS нужен Homebrew: https://brew.sh"
        exit 1
      fi
      log "Docker не найден — устанавливаю Docker Desktop через Homebrew."
      brew install --cask docker
      open -a Docker
      ;;
    *)
      log "Автоустановка Docker для этой ОС не поддерживается: https://docs.docker.com/engine/install/"
      exit 1
      ;;
  esac
}

wait_for_docker() {
  log "Проверяю Docker daemon."
  for _ in $(seq 1 60); do
    if docker info >/dev/null 2>&1; then
      return
    fi
    sleep 2
  done
  log "Docker установлен, но daemon не запустился за 120 секунд. Запустите Docker и повторите команду."
  exit 1
}

resolve_project() {
  if [ -f "${SCRIPT_DIR}/docker-compose.yaml" ] && [ -d "${SCRIPT_DIR}/../.git" ]; then
    PROJECT_DIR="${SCRIPT_DIR}"
    REPOSITORY_DIR="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
  else
    REPOSITORY_DIR="${INSTALL_ROOT}"
    PROJECT_DIR="${REPOSITORY_DIR}/online-balancers"
    if [ ! -d "${REPOSITORY_DIR}/.git" ]; then
      log "Клонирую web-plugins."
      mkdir -p -- "$(dirname -- "${REPOSITORY_DIR}")"
      git clone "${REPOSITORY_URL}" "${REPOSITORY_DIR}"
    fi
  fi
}

update_repository() {
  if [ -n "$(git -C "${REPOSITORY_DIR}" status --porcelain)" ]; then
    log "В checkout есть локальные изменения — обновление пропущено, файлы не затронуты."
    return
  fi
  log "Обновляю web-plugins."
  git -C "${REPOSITORY_DIR}" pull --ff-only
}

start_service() {
  log "Собираю и запускаю сервис."
  docker compose --file "${PROJECT_DIR}/docker-compose.yaml" build --pull
  docker compose --file "${PROJECT_DIR}/docker-compose.yaml" up --detach --remove-orphans
  log "Готово. URL плагина: http://localhost:8090/plugin"
}

install_docker
wait_for_docker
resolve_project
update_repository
start_service
