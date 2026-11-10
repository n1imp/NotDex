#!/bin/sh
set -eu
notdex_repo=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
exec sh "$notdex_repo/notdex.sh" "$@"
