#!/bin/sh
set -eu
notdex_repo=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
notdex_home=${CODEX_HOME:-${HOME}/.codex}
notdex_no_download=false
notdex_no_packages=false
while [ "$#" -gt 0 ]; do
    case "$1" in
        --codex-home) [ "$#" -ge 2 ] || exit 1; notdex_home=$2; shift 2 ;;
        --no-download) notdex_no_download=true; shift ;;
        --no-system-packages) notdex_no_packages=true; shift ;;
        --help) printf '%s\n' 'NotDex: sh install.sh [--codex-home PATH] [--no-download] [--no-system-packages]'; exit 0 ;;
        *) printf 'NotDex: unknown option: %s\n' "$1" >&2; exit 1 ;;
    esac
done
command -v codex >/dev/null 2>&1 || { printf '%s\n' 'NotDex: install Codex CLI and add it to PATH first.' >&2; exit 1; }
. "$notdex_repo/scripts/linux-deps.sh"
notdex_linux_dependencies "$notdex_no_packages"
. "$notdex_repo/scripts/bootstrap.sh"
notdex_bootstrap "$notdex_repo" "$notdex_home" "$notdex_no_download"
exec "$NOTDEX_NODE" --no-warnings "$notdex_repo/install.cjs" --codex-home "$notdex_home"
