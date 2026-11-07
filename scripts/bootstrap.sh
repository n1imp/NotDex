#!/bin/sh

notdex_node_compatible() {
    [ -x "$1" ] || return 1
    notdex_candidate_version=$("$1" --version 2>/dev/null) || return 1
    notdex_candidate_major=${notdex_candidate_version#v}
    notdex_candidate_major=${notdex_candidate_major%%.*}
    [ "$notdex_candidate_major" -ge 24 ] 2>/dev/null
}

notdex_sha256() {
    if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | awk '{print $1}'
    elif command -v shasum >/dev/null 2>&1; then shasum -a 256 "$1" | awk '{print $1}'
    else openssl dgst -sha256 "$1" | awk '{print $NF}'; fi
}

notdex_cache_attributes() {
    if [ "$notdex_os" = darwin ]; then stat -f '%u %Lp' "$1"
    else stat -c '%u %a' -- "$1"; fi
}

notdex_cache_safe() {
    notdex_guard_base=$1
    notdex_guard_uid=$(id -u)
    [ ! -e "$1" ] || [ -d "$1" ] || return 1
    [ ! -e "$1/runtime" ] || [ -d "$1/runtime" ] || return 1
    [ ! -e "$2" ] || [ -f "$2" ] || return 1
    for notdex_guard_path in "$1" "$1/runtime" "$2"; do
        [ ! -L "$notdex_guard_path" ] || return 1
        if [ -e "$notdex_guard_path" ]; then
            set -- $(notdex_cache_attributes "$notdex_guard_path")
            [ "$#" = 2 ] && [ "$1" = "$notdex_guard_uid" ] && [ "$((0$2 & 022))" = 0 ] || return 1
        fi
    done
    notdex_guard_path=$(dirname -- "$notdex_guard_base")
    while :; do
        if [ -e "$notdex_guard_path" ] || [ -L "$notdex_guard_path" ]; then
            set -- $(notdex_cache_attributes "$notdex_guard_path")
            [ "$#" = 2 ] || return 1
            if [ -L "$notdex_guard_path" ]; then
                # Permit root-owned system aliases such as macOS /var and /tmp.
                [ "$1" = 0 ] && [ "$(dirname -- "$notdex_guard_path")" = / ] || return 1
            else
                [ "$1" = 0 ] || [ "$1" = "$notdex_guard_uid" ] || return 1
                if [ "$((0$2 & 022))" != 0 ]; then
                    [ "$1" = 0 ] && [ "$((0$2 & 01000))" != 0 ] || return 1
                fi
            fi
        fi
        [ "$notdex_guard_path" != / ] || break
        notdex_guard_parent=$(dirname -- "$notdex_guard_path")
        [ "$notdex_guard_parent" != "$notdex_guard_path" ] || break
        notdex_guard_path=$notdex_guard_parent
    done
}

notdex_bootstrap() {
    notdex_repo=$1
    notdex_no_download=$3
    NOTDEX_NODE=''
    # An installation record must not select an executable before cache validation.
    notdex_existing=$(command -v node 2>/dev/null || :)
    if [ -n "$notdex_existing" ] && notdex_node_compatible "$notdex_existing"; then NOTDEX_NODE=$notdex_existing; return; fi
    notdex_version=$(cat "$notdex_repo/scripts/node-version.txt")
    case $(uname -s) in
        Darwin) notdex_os=darwin; notdex_cache_base=${NOTDEX_CACHE_HOME:-${HOME}/Library/Caches/NotDex} ;;
        Linux) notdex_os=linux; notdex_cache_base=${NOTDEX_CACHE_HOME:-${XDG_CACHE_HOME:-${HOME}/.cache}/notdex} ;;
        *) printf '%s\n' 'NotDex: use Install.cmd on Windows.' >&2; return 1 ;;
    esac
    case $(uname -m) in
        x86_64|amd64) notdex_arch=x64 ;;
        aarch64|arm64) notdex_arch=arm64 ;;
        *) printf '%s\n' 'NotDex: automatic Node download supports x64 and ARM64.' >&2; return 1 ;;
    esac
    notdex_flavour=''
    if [ "$notdex_os" = linux ] && { ldd --version 2>&1 || :; } | grep -qi musl; then notdex_flavour=-musl; fi
    notdex_package=node-v${notdex_version}-${notdex_os}-${notdex_arch}${notdex_flavour}
    notdex_asset=${notdex_package}.tar.gz
    notdex_expected=$(awk -v file="$notdex_asset" '$2 == file { print $1 }' "$notdex_repo/scripts/node-shasums.txt")
    notdex_binary_expected=$(awk -v file="$notdex_package/bin/node" '$2 == file { print $1 }' "$notdex_repo/scripts/node-shasums.txt")
    [ -n "$notdex_expected" ] && [ -n "$notdex_binary_expected" ] || { printf '%s\n' 'NotDex: no pinned runtime for this platform; install Node.js 24+ first.' >&2; return 1; }
    notdex_cache=$notdex_cache_base/runtime
    notdex_target=$notdex_cache/$notdex_package
    notdex_cache_safe "$notdex_cache_base" "$notdex_target" || { printf '%s\n' 'NotDex: unsafe cache link, owner or permissions; select a private cache directory.' >&2; return 1; }
    if [ -f "$notdex_target" ] && [ -x "$notdex_target" ] && [ "$(notdex_sha256 "$notdex_target")" = "$notdex_binary_expected" ]; then NOTDEX_NODE=$notdex_target; return; fi
    [ "$notdex_no_download" = false ] || { printf '%s\n' 'NotDex: no verified private Node runtime; run install.sh online or put Node.js 24+ on PATH.' >&2; return 1; }
    umask 077
    mkdir -p "$notdex_cache"
    notdex_cache_safe "$notdex_cache_base" "$notdex_target" || { printf '%s\n' 'NotDex: unsafe cache link, owner or permissions.' >&2; return 1; }
    notdex_stage=$(mktemp -d "$notdex_cache/.download.XXXXXXXX")
    trap 'rm -rf -- "$notdex_stage"' EXIT HUP INT TERM
    printf '%s\n' "NotDex: downloading private Node.js $notdex_version from nodejs.org; global Node is unchanged." >&2
    if command -v curl >/dev/null 2>&1; then
        curl --proto '=https' --tlsv1.2 -fsSL "https://nodejs.org/dist/v$notdex_version/$notdex_asset" -o "$notdex_stage/node.tar.gz"
    elif command -v wget >/dev/null 2>&1; then
        wget -q "https://nodejs.org/dist/v$notdex_version/$notdex_asset" -O "$notdex_stage/node.tar.gz"
    else printf '%s\n' 'NotDex: install curl or wget, or Node.js 24+, then retry.' >&2; return 1
    fi
    notdex_actual=$(notdex_sha256 "$notdex_stage/node.tar.gz")
    [ "$notdex_actual" = "$notdex_expected" ] || { printf '%s\n' 'NotDex: Node download failed SHA-256 verification.' >&2; return 1; }
    tar -xzf "$notdex_stage/node.tar.gz" --no-same-owner -C "$notdex_stage" "$notdex_package/bin/node"
    [ -f "$notdex_stage/$notdex_package/bin/node" ] && [ ! -L "$notdex_stage/$notdex_package/bin/node" ] && [ "$(notdex_sha256 "$notdex_stage/$notdex_package/bin/node")" = "$notdex_binary_expected" ] || { printf '%s\n' 'NotDex: Node executable failed SHA-256 verification.' >&2; return 1; }
    chmod 755 "$notdex_stage/$notdex_package/bin/node"
    mv -f "$notdex_stage/$notdex_package/bin/node" "$notdex_target"
    rm -rf -- "$notdex_stage"
    trap - EXIT HUP INT TERM
    NOTDEX_NODE=$notdex_target
}
