#!/usr/bin/env bash
# Development helper: ./dev.sh <command>
set -euo pipefail

UUID="pr-monitor@adaspt"
EXTENSIONS_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/gnome-shell/extensions"
cd "$(dirname "$0")"

case "${1:-}" in
  schemas)
    glib-compile-schemas --strict schemas
    ;;
  install)
    # Symlinks this checkout into the extensions directory, so edits are
    # picked up by the next shell start (or the next nested shell).
    "$0" schemas
    mkdir -p "$EXTENSIONS_DIR"
    ln -sfn "$PWD" "$EXTENSIONS_DIR/$UUID"
    echo "Linked $EXTENSIONS_DIR/$UUID -> $PWD"
    ;;
  uninstall)
    rm -f "$EXTENSIONS_DIR/$UUID"
    ;;
  test)
    gjs -m tests/run.js
    ;;
  nested)
    # A separate GNOME Shell in a window, for testing without logging out.
    # Needs: sudo dnf install mutter-devkit
    "$0" install
    dbus-run-session gnome-shell --devkit
    ;;
  log)
    journalctl -f -o cat /usr/bin/gnome-shell
    ;;
  *)
    echo "usage: $0 {schemas|install|uninstall|test|nested|log}" >&2
    exit 1
    ;;
esac
