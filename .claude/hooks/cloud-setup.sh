#!/usr/bin/env bash
# SessionStart hook: prepares a Claude Code cloud session for this project.
#
# The cloud machines have Node.js 20 to 22 but the project needs Node.js 24, so
# this script installs Node.js 24 (checked against its published checksum), puts
# it first on PATH for the commands Claude runs, and installs the npm packages.
# Its one line of output tells Claude what state the session is in.
#
# It does nothing outside a cloud session (CLAUDE_CODE_REMOTE is not "true").

if [ "$CLAUDE_CODE_REMOTE" != "true" ]; then exit 0; fi

NODE_VERSION=v24.20.0
# Published SHA-256 of node-v24.20.0-linux-x64.tar.xz, from
# https://nodejs.org/dist/v24.20.0/SHASUMS256.txt
NODE_SHA256=2f2c0da162318f0de47665410c7c8c2ed3d36c8f3105de4bbc61176c70a7cbf2
NODE_DIR="$HOME/.local/node-$NODE_VERSION-linux-x64"

node_ok=1
npm_ok=1

# 1. Node.js 24: skip the download if the node on PATH is already 24 or newer.
current_major="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null)"
if [ -n "$current_major" ] && [ "$current_major" -ge 24 ] 2>/dev/null; then
  :
else
  if [ ! -x "$NODE_DIR/bin/node" ]; then
    tmp_dir="$(mktemp -d)"
    archive="node-$NODE_VERSION-linux-x64.tar.xz"
    if curl -fsSL --retry 2 -o "$tmp_dir/$archive" "https://nodejs.org/dist/$NODE_VERSION/$archive" >&2 \
      && printf '%s  %s\n' "$NODE_SHA256" "$archive" > "$tmp_dir/check.sha256" \
      && (cd "$tmp_dir" && sha256sum --check --status check.sha256); then
      mkdir -p "$HOME/.local" && tar -xJf "$tmp_dir/$archive" -C "$HOME/.local" >&2
    fi
    rm -rf "$tmp_dir"
  fi

  if [ -x "$NODE_DIR/bin/node" ]; then
    export PATH="$NODE_DIR/bin:$PATH"
    if [ -n "$CLAUDE_ENV_FILE" ] && ! grep -qF "$NODE_DIR/bin" "$CLAUDE_ENV_FILE" 2>/dev/null; then
      printf 'export PATH="%s/bin:$PATH"\n' "$NODE_DIR" >> "$CLAUDE_ENV_FILE"
    fi
  else
    node_ok=0
  fi
fi

# 2. npm packages: run npm ci only when package files or this script changed.
if [ "$node_ok" = 1 ]; then
  cd "$CLAUDE_PROJECT_DIR" || exit 0
  stamp="node_modules/.cloud-setup.sha256"
  if ! sha256sum --check --status "$stamp" 2>/dev/null; then
    rm -f "$stamp"
    if npm ci --no-audit --no-fund >&2; then
      mkdir -p node_modules
      sha256sum package.json package-lock.json .claude/hooks/cloud-setup.sh > "$stamp"
    else
      npm_ok=0
    fi
  fi
fi

if [ "$node_ok" = 0 ]; then
  echo "Node 24 could not be installed: run the tests with the Node on PATH and say so in your report."
elif [ "$npm_ok" = 0 ]; then
  echo "npm ci failed: run it again and read the error."
else
  echo "Cloud session ready: Node $(node -v 2>/dev/null) and npm packages installed."
fi
exit 0
