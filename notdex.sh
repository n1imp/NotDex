#!/bin/sh
set -eu
notdex_repo=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
notdex_home=${CODEX_HOME:-${HOME}/.codex}
. "$notdex_repo/scripts/bootstrap.sh"
notdex_bootstrap "$notdex_repo" "$notdex_home" true
exec "$NOTDEX_NODE" --no-warnings "$notdex_repo/notdex.cjs" "$@"
