#!/usr/bin/env bash
# Loreloom installer for macOS and Linux.
#
#   curl -fsSL https://getloreloom.vercel.app/install.sh | bash
#
# What it does, all inside your own user folder (no admin password needed):
#   1. Downloads a private copy of Node.js into ~/.loreloom/node, if you
#      don't already have Node 22 or newer. The download is checked
#      against nodejs.org's published checksums.
#   2. Downloads Loreloom into ~/.loreloom/app and prepares it.
#   3. Adds a Loreloom app (macOS: ~/Applications, Linux: your app menu).
#   4. Offers to install Claude Code, which powers the optional AI helper,
#      using Anthropic's official installer, and lets you sign in.
#
# Your books live in ~/Loreloom. Re-running this script updates Loreloom
# and never touches your books.
#
# Uninstall: rm -rf ~/.loreloom ~/Applications/Loreloom.app
#            (Linux: also ~/.local/share/applications/loreloom.desktop)

set -euo pipefail

REPO="prabhavmakkar/loreloom"
REF="${LORELOOM_REF:-main}"
NODE_MAJOR=22
ROOT="${LORELOOM_HOME:-$HOME/.loreloom}"
APP_DIR="$ROOT/app"
NODE_DIR="$ROOT/node"
BIN_DIR="$ROOT/bin"

bold=$(printf '\033[1m'); dim=$(printf '\033[2m'); reset=$(printf '\033[0m')
say()  { printf '%s\n' "$*"; }
step() { printf '\n%s→ %s%s\n' "$bold" "$*" "$reset"; }
fail() { printf '\n%sSomething went wrong:%s %s\n' "$bold" "$reset" "$*" >&2
         printf 'Nothing in your books folder was changed. You can run the installer again,\n' >&2
         printf 'or ask for help at https://github.com/%s/issues\n' "$REPO" >&2; exit 1; }

# Ask a yes/no question even when this script is piped into bash.
ask() {
  local answer
  if [ -n "${LORELOOM_YES:-}" ]; then return 0; fi
  if [ -n "${LORELOOM_NO_PROMPT:-}" ] || ! { : </dev/tty; } 2>/dev/null; then return 1; fi
  printf '%s [Y/n] ' "$1" >/dev/tty
  read -r answer </dev/tty || return 1
  case "$answer" in [nN]*) return 1 ;; *) return 0 ;; esac
}

need() { command -v "$1" >/dev/null 2>&1 || fail "this installer needs '$1', which isn't on this computer."; }
need curl
need tar

OS=$(uname -s)
ARCH=$(uname -m)
case "$OS" in
  Darwin) PLATFORM=darwin ;;
  Linux)  PLATFORM=linux ;;
  *) fail "Loreloom's installer supports macOS and Linux. For Windows, see https://getloreloom.vercel.app/#install" ;;
esac
case "$ARCH" in
  arm64|aarch64) NODE_ARCH=arm64 ;;
  x86_64|amd64)  NODE_ARCH=x64 ;;
  *) fail "unsupported processor type: $ARCH" ;;
esac

say ""
say "${bold}Loreloom installer${reset}"
say "${dim}Free, open-source writing software. Your books stay on this computer.${reset}"

mkdir -p "$ROOT" "$BIN_DIR"
TMP=$(mktemp -d "${TMPDIR:-/tmp}/loreloom.XXXXXX")
trap 'rm -rf "$TMP"' EXIT

# ---------------------------------------------------------------- Node.js
node_ok() {
  local v
  v=$("$1" -p 'process.versions.node.split(".")[0]' 2>/dev/null) || return 1
  [ "$v" -ge "$NODE_MAJOR" ]
}

NODE=""
if [ -x "$NODE_DIR/bin/node" ] && node_ok "$NODE_DIR/bin/node"; then
  NODE="$NODE_DIR/bin/node"
elif [ -z "${LORELOOM_FORCE_NODE_DOWNLOAD:-}" ] && command -v node >/dev/null 2>&1 && node_ok "$(command -v node)"; then
  NODE="$(command -v node)"
fi

if [ -z "$NODE" ]; then
  step "Downloading Node.js $NODE_MAJOR (the engine Loreloom runs on)"
  BASE="https://nodejs.org/dist/latest-v${NODE_MAJOR}.x"
  curl -fsSL "$BASE/SHASUMS256.txt" -o "$TMP/SHASUMS256.txt" || fail "couldn't reach nodejs.org. Check your internet connection."
  FILE=$(grep -oE "node-v[0-9.]+-${PLATFORM}-${NODE_ARCH}\.tar\.gz" "$TMP/SHASUMS256.txt" | head -1)
  [ -n "$FILE" ] || fail "couldn't find a Node.js download for ${PLATFORM}-${NODE_ARCH}."
  curl -fSL --progress-bar "$BASE/$FILE" -o "$TMP/$FILE" || fail "the Node.js download failed."
  EXPECTED=$(grep " $FILE\$" "$TMP/SHASUMS256.txt" | cut -d' ' -f1)
  if command -v shasum >/dev/null 2>&1; then ACTUAL=$(shasum -a 256 "$TMP/$FILE" | cut -d' ' -f1)
  else ACTUAL=$(sha256sum "$TMP/$FILE" | cut -d' ' -f1); fi
  [ "$EXPECTED" = "$ACTUAL" ] || fail "the Node.js download didn't match its checksum, so it wasn't used."
  rm -rf "$NODE_DIR" && mkdir -p "$NODE_DIR"
  tar -xzf "$TMP/$FILE" -C "$NODE_DIR" --strip-components=1
  NODE="$NODE_DIR/bin/node"
  say "${dim}Node.js $("$NODE" -v) installed privately in $NODE_DIR${reset}"
else
  say "${dim}Using Node.js $("$NODE" -v) at $NODE${reset}"
fi
NODE_BIN=$(dirname "$NODE")
export PATH="$NODE_BIN:$PATH"

# ---------------------------------------------------------------- Loreloom
# Stop a running copy before replacing its files.
pkill -f "$APP_DIR/packages/server/src/cli.ts" 2>/dev/null || true

step "Downloading Loreloom"
if [ -n "${LORELOOM_TARBALL:-}" ]; then
  cp "$LORELOOM_TARBALL" "$TMP/loreloom.tar.gz"
else
  curl -fsSL "https://codeload.github.com/$REPO/tar.gz/$REF" -o "$TMP/loreloom.tar.gz" \
    || fail "couldn't download Loreloom from GitHub."
fi
mkdir -p "$TMP/src"
tar -xzf "$TMP/loreloom.tar.gz" -C "$TMP/src" --strip-components=1

step "Setting up Loreloom (this takes a minute or two)"
(
  cd "$TMP/src"
  "$NODE_BIN/npm" ci --no-audit --no-fund --loglevel=error >"$TMP/npm.log" 2>&1 \
    || { tail -20 "$TMP/npm.log" >&2; exit 1; }
  "$NODE_BIN/npm" run build -w @loreloom/web >"$TMP/build.log" 2>&1 \
    || { tail -20 "$TMP/build.log" >&2; exit 1; }
) || fail "setting up Loreloom failed (details above)."
rm -rf "$APP_DIR.old"
[ -d "$APP_DIR" ] && mv "$APP_DIR" "$APP_DIR.old"
mv "$TMP/src" "$APP_DIR"
rm -rf "$APP_DIR.old"

# ---------------------------------------------------------------- launcher
# One launcher script that every shortcut calls. Apps opened from the Dock or
# app menu get a bare PATH, so it adds the usual places Claude Code and Node
# live. It only ever adds folders to PATH; it reads nothing from them.
cat >"$BIN_DIR/loreloom" <<LAUNCHER
#!/usr/bin/env bash
export PATH="$NODE_BIN:\$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:\$PATH"
APP="$APP_DIR"
LOG="$ROOT/loreloom.log"

case "\${1:-}" in
  stop) pkill -f "\$APP/packages/server/src/cli.ts" && echo "Loreloom stopped." || echo "Loreloom wasn't running."; exit 0 ;;
esac

# Already running? Just open it.
for port in 4317 4318 4319 4320 4321 4322 4323 4324 4325 4326 4327; do
  if curl -fs -m 1 -H 'X-Loreloom: 1' "http://127.0.0.1:\$port/api/ai/status" >/dev/null 2>&1; then
    url="http://127.0.0.1:\$port"
    if command -v open >/dev/null 2>&1; then open "\$url"; else xdg-open "\$url" >/dev/null 2>&1 || echo "\$url"; fi
    exit 0
  fi
done

cd "\$APP"
nohup "$NODE" "\$APP/node_modules/tsx/dist/cli.mjs" "\$APP/packages/server/src/cli.ts" "\$@" >"\$LOG" 2>&1 &
disown || true
LAUNCHER
chmod +x "$BIN_DIR/loreloom"

step "Adding Loreloom to your apps"
if [ "$PLATFORM" = darwin ]; then
  BUNDLE="${LORELOOM_APPS_DIR:-$HOME/Applications}/Loreloom.app"
  rm -rf "$BUNDLE"
  mkdir -p "$BUNDLE/Contents/MacOS" "$BUNDLE/Contents/Resources"
  cat >"$BUNDLE/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleName</key><string>Loreloom</string>
  <key>CFBundleDisplayName</key><string>Loreloom</string>
  <key>CFBundleIdentifier</key><string>io.github.prabhavmakkar.loreloom</string>
  <key>CFBundleVersion</key><string>0.1.0</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleExecutable</key><string>Loreloom</string>
  <key>CFBundleIconFile</key><string>loreloom</string>
  <key>LSUIElement</key><true/>
</dict></plist>
PLIST
  printf '#!/bin/bash\nexec "%s"\n' "$BIN_DIR/loreloom" >"$BUNDLE/Contents/MacOS/Loreloom"
  chmod +x "$BUNDLE/Contents/MacOS/Loreloom"
  # Turn the logo into a Mac icon, if the tools are there. Purely cosmetic.
  if [ -f "$APP_DIR/docs/logo.png" ] && command -v iconutil >/dev/null 2>&1 && command -v sips >/dev/null 2>&1; then
    ICONSET="$TMP/loreloom.iconset"; mkdir -p "$ICONSET"
    for s in 16 32 128 256 512; do
      sips -z $s $s "$APP_DIR/docs/logo.png" --out "$ICONSET/icon_${s}x${s}.png" >/dev/null 2>&1 || true
      d=$((s * 2)); [ $d -le 512 ] && sips -z $d $d "$APP_DIR/docs/logo.png" --out "$ICONSET/icon_${s}x${s}@2x.png" >/dev/null 2>&1 || true
    done
    iconutil -c icns "$ICONSET" -o "$BUNDLE/Contents/Resources/loreloom.icns" 2>/dev/null || true
  fi
  touch "$BUNDLE"
  say "${dim}Added Loreloom to $(dirname "$BUNDLE"). Find it with Spotlight (⌘ Space, type Loreloom).${reset}"
else
  DESKTOP_DIR="$HOME/.local/share/applications"; mkdir -p "$DESKTOP_DIR"
  cat >"$DESKTOP_DIR/loreloom.desktop" <<DESKTOP
[Desktop Entry]
Type=Application
Name=Loreloom
Comment=Write your novel
Exec=$BIN_DIR/loreloom
Icon=$APP_DIR/docs/logo.png
Terminal=false
Categories=Office;TextEditor;
DESKTOP
  say "${dim}Added Loreloom to your app menu.${reset}"
fi

# ---------------------------------------------------------------- Claude Code
step "AI helper"
CLAUDE=""
for c in "$(command -v claude 2>/dev/null || true)" "$HOME/.local/bin/claude" /opt/homebrew/bin/claude /usr/local/bin/claude; do
  if [ -n "$c" ] && [ -x "$c" ]; then CLAUDE="$c"; break; fi
done

if [ -z "$CLAUDE" ]; then
  say "Loreloom's AI helper (brainstorm, draft, review) runs on Claude Code, using"
  say "your own Claude Pro or Max plan. Loreloom works without it, too."
  if ask "Install Claude Code now with Anthropic's official installer?"; then
    curl -fsSL https://claude.ai/install.sh | bash || say "Claude Code didn't install. You can try later from https://code.claude.com"
    [ -x "$HOME/.local/bin/claude" ] && CLAUDE="$HOME/.local/bin/claude"
  else
    say "${dim}Skipped. You can add it any time: https://code.claude.com${reset}"
  fi
fi

if [ -n "$CLAUDE" ]; then
  if "$CLAUDE" auth status --json 2>/dev/null | grep -q '"loggedIn": *true'; then
    say "${dim}Claude Code is installed and signed in. The AI helper is ready.${reset}"
  elif ask "Sign in to Claude now? (a browser window will open)"; then
    "$CLAUDE" auth login </dev/tty || say "You can sign in later: open Terminal and type: claude auth login"
  else
    say "${dim}To use the AI helper later, open Terminal and type: claude auth login${reset}"
  fi
fi

# ---------------------------------------------------------------- done
say ""
say "${bold}Loreloom is installed.${reset}"
if [ "$PLATFORM" = darwin ]; then
  say "Open it any time from Spotlight or your Applications folder."
else
  say "Open it any time from your app menu, or run: $BIN_DIR/loreloom"
fi
say "Your books are saved in ~/Loreloom, on this computer only."
if [ -z "${LORELOOM_NO_LAUNCH:-}" ]; then
  say "${dim}Opening Loreloom in your browser…${reset}"
  "$BIN_DIR/loreloom" || true
fi
