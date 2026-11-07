#!/bin/sh
notdex_repo=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
sh "$notdex_repo/uninstall.sh" "$@"
notdex_status=$?
printf '\nPress Return to close. '
read -r notdex_answer
exit "$notdex_status"
