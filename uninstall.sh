#!/bin/sh
set -eu
notdex_repo=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
notdex_home=${CODEX_HOME:-${HOME}/.codex}
while [ "$#" -gt 0 ]; do
    case "$1" in
        --codex-home) [ "$#" -ge 2 ] || exit 1; notdex_home=$2; shift 2 ;;
        --help) printf '%s\n' 'NotDex: sh uninstall.sh [--codex-home PATH]'; exit 0 ;;
        *) printf 'NotDex: unknown option: %s\n' "$1" >&2; exit 1 ;;
    esac
done
. "$notdex_repo/scripts/bootstrap.sh"
notdex_bootstrap "$notdex_repo" "$notdex_home" true
exec "$NOTDEX_NODE" --no-warnings "$notdex_repo/uninstall.cjs" --codex-home "$notdex_home"
