#!/bin/sh

notdex_linux_dependencies() {
    [ "$(uname -s)" = Linux ] || return 0
    if [ -z "${DISPLAY:-}" ] && [ -z "${WAYLAND_DISPLAY:-}" ]; then
        printf '%s\n' 'NotDex: run the installer inside a Linux desktop session, not an SSH/headless shell.' >&2
        return 1
    fi
    notdex_need_notify=false
    notdex_need_clip=false
    command -v notify-send >/dev/null 2>&1 || notdex_need_notify=true
    if [ -n "${WAYLAND_DISPLAY:-}" ] && command -v wl-copy >/dev/null 2>&1; then :
    elif [ -n "${DISPLAY:-}" ] && { command -v xclip >/dev/null 2>&1 || command -v xsel >/dev/null 2>&1; }; then :
    else notdex_need_clip=true; fi
    if [ "$notdex_need_notify" = false ] && [ "$notdex_need_clip" = false ]; then return 0; fi
    [ "$1" = false ] || { printf '%s\n' 'NotDex: missing notify-send and/or a clipboard tool; system package installation was disabled.' >&2; return 1; }
    notdex_clip_package=xclip
    [ -z "${WAYLAND_DISPLAY:-}" ] || notdex_clip_package=wl-clipboard
    if command -v apt-get >/dev/null 2>&1; then notdex_manager=apt-get; notdex_notify_package=libnotify-bin
    elif command -v dnf >/dev/null 2>&1; then notdex_manager=dnf; notdex_notify_package=libnotify
    elif command -v pacman >/dev/null 2>&1; then notdex_manager=pacman; notdex_notify_package=libnotify
    elif command -v zypper >/dev/null 2>&1; then notdex_manager=zypper; notdex_notify_package=libnotify-tools
    else printf '%s\n' 'NotDex: install notify-send and wl-copy (Wayland) or xclip/xsel (X11) with your distribution package manager.' >&2; return 1
    fi
    notdex_packages=''
    [ "$notdex_need_notify" = false ] || notdex_packages=$notdex_notify_package
    [ "$notdex_need_clip" = false ] || notdex_packages="$notdex_packages $notdex_clip_package"
    printf 'NotDex needs these desktop packages: %s. Install with %s and sudo if needed? [y/N] ' "$notdex_packages" "$notdex_manager" >&2
    IFS= read -r notdex_answer || return 1
    case "$notdex_answer" in y|Y|yes|YES) ;; *) printf '%s\n' 'NotDex: cancelled; no hook was installed.' >&2; return 1 ;; esac
    if [ "$(id -u)" = 0 ]; then notdex_sudo=''; else notdex_sudo=sudo; fi
    case "$notdex_manager" in
        apt-get) $notdex_sudo apt-get update; $notdex_sudo apt-get install -y $notdex_packages ;;
        dnf) $notdex_sudo dnf install -y $notdex_packages ;;
        pacman) $notdex_sudo pacman -S --needed --noconfirm $notdex_packages ;;
        zypper) $notdex_sudo zypper --non-interactive install $notdex_packages ;;
    esac
}
