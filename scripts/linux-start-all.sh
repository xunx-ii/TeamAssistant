#!/usr/bin/env sh
set -eu

if [ "$(id -u)" -eq 0 ]; then
  SUDO=""
else
  SUDO="sudo"
fi

need_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "缺少命令：$1" >&2
    exit 1
  fi
}

need_cmd apt-get
need_cmd node
need_cmd npm

if [ -n "$SUDO" ]; then
  need_cmd "$SUDO"
fi

$SUDO apt-get update
$SUDO apt-get install -y \
  ca-certificates \
  git \
  build-essential \
  cmake \
  pkg-config \
  uuid-dev \
  libssl-dev \
  zlib1g-dev \
  libsqlite3-dev \
  libjsoncpp-dev \
  libbrotli-dev


npm install
npm run start:all
