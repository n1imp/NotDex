#!/bin/sh
set -eu
notdex_repo=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
notdex_home=${CODEX_HOME:-${HOME}/.codex}
notdex_no_shell=false
while [ "$#" -gt 0 ]; do
    case "$1" in
        --codex-home) [ "$#" -ge 2 ] || exit 1; notdex_home=$2; shift 2 ;;
        --no-shell-integration) notdex_no_shell=true; shift ;;
        --help) printf '%s\n' 'NotDex: sh uninstall.sh [--codex-home PATH] [--no-shell-integration]'; exit 0 ;;
        *) printf 'NotDex: unknown option: %s\n' "$1" >&2; exit 1 ;;
    esac
done
. "$notdex_repo/scripts/bootstrap.sh"
notdex_bootstrap "$notdex_repo" "$notdex_home" true
set -- --codex-home "$notdex_home"
if [ "$notdex_no_shell" = true ]; then set -- "$@" --no-shell-integration; fi
exec "$NOTDEX_NODE" --no-warnings "$notdex_repo/uninstall.cjs" "$@"
