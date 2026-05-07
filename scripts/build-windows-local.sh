#!/usr/bin/env bash
# Build a portable Windows .exe locally with the version derived from the latest
# git tag (or a tag passed as the first argument). Mirrors the version
# substitution from .github/workflows/build-release.yml so local builds report
# the same version a CI release would.
#
# Usage:
#   scripts/build-windows-local.sh                # uses latest v* tag
#   scripts/build-windows-local.sh v0.7.0-beta    # uses a specific tag

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

# ---------- Pre-flight: git repo check ----------

if ! git rev-parse --git-dir >/dev/null 2>&1; then
    echo "ERROR: $ROOT_DIR is not a git repository." >&2
    echo "       Run this script from inside the cloned coinman-app repo." >&2
    exit 1
fi

# ---------- Pre-flight: Linux distro check ----------

if [ ! -r /etc/os-release ]; then
    echo "ERROR: cannot read /etc/os-release (unsupported OS)." >&2
    exit 1
fi
# shellcheck source=/dev/null
. /etc/os-release
case "${ID:-}${ID_LIKE:+ ${ID_LIKE}}" in
    *debian*|*ubuntu*) ;;
    *)
        echo "ERROR: this script supports Debian/Ubuntu-based distros only." >&2
        echo "       Detected: ID=${ID:-unknown} ID_LIKE=${ID_LIKE:-unknown}" >&2
        exit 1
        ;;
esac

# ---------- Pre-flight: collect missing components ----------

missing_apt=()
missing_cargo=()
missing_rustup=()

if ! command -v rustup >/dev/null 2>&1 || ! command -v cargo >/dev/null 2>&1; then
    echo "ERROR: rustup/cargo not found. Install Rust first: https://rustup.rs/" >&2
    exit 1
fi

# Rust target for cross-compiling to Windows MSVC
if ! rustup target list --installed 2>/dev/null | grep -qx 'x86_64-pc-windows-msvc'; then
    missing_rustup+=("x86_64-pc-windows-msvc")
fi

# Cargo subcommands
if ! command -v cargo-xwin >/dev/null 2>&1; then
    missing_cargo+=("cargo-xwin")
fi
if ! cargo tauri --version >/dev/null 2>&1; then
    missing_cargo+=("tauri-cli")
fi

# System packages cargo-xwin needs to link MSVC objects from Linux
for pkg in clang lld llvm; do
    if ! dpkg-query -W -f='${Status}' "$pkg" 2>/dev/null | grep -q 'install ok installed'; then
        missing_apt+=("$pkg")
    fi
done

total_missing=$(( ${#missing_apt[@]} + ${#missing_cargo[@]} + ${#missing_rustup[@]} ))

if [ "$total_missing" -gt 0 ]; then
    echo ""
    echo "The following components are required to compile the Windows binary"
    echo "but are not installed on your system:"
    echo ""
    [ ${#missing_apt[@]} -gt 0 ]    && printf "  apt packages:     %s\n" "${missing_apt[*]}"
    [ ${#missing_rustup[@]} -gt 0 ] && printf "  Rust targets:     %s\n" "${missing_rustup[*]}"
    [ ${#missing_cargo[@]} -gt 0 ]  && printf "  Cargo subcmds:    %s\n" "${missing_cargo[*]}"
    echo ""
    read -rp "Install them now? [Y/n] " answer
    answer="${answer:-Y}"
    case "$answer" in
        [Yy]*)
            if [ ${#missing_apt[@]} -gt 0 ]; then
                echo "→ Installing apt packages (sudo)..."
                sudo apt-get update
                sudo apt-get install -y "${missing_apt[@]}"
            fi
            if [ ${#missing_rustup[@]} -gt 0 ]; then
                for t in "${missing_rustup[@]}"; do
                    echo "→ Adding Rust target: $t"
                    rustup target add "$t"
                done
            fi
            if [ ${#missing_cargo[@]} -gt 0 ]; then
                for c in "${missing_cargo[@]}"; do
                    if [ "$c" = "tauri-cli" ]; then
                        echo "→ Installing tauri-cli (^2)..."
                        cargo install tauri-cli --version "^2" --locked
                    else
                        echo "→ Installing $c..."
                        cargo install --locked "$c"
                    fi
                done
            fi
            echo ""
            ;;
        *)
            echo "Aborted by user. Cannot proceed without the required components."
            exit 1
            ;;
    esac
fi

# ---------- Version derivation ----------

FILES=(
    "src-tauri/Cargo.toml"
    "src-tauri/tauri.conf.json"
    "src-tauri/Cargo.lock"
    "frontend/index.js"
)

git fetch --tags --quiet origin || true

TAG="${1:-$(git tag --list 'v*' --sort=-v:refname | head -n 1)}"
if [ -z "$TAG" ]; then
    echo "ERROR: no v* tag found (locally or on origin)." >&2
    exit 1
fi
VERSION="${TAG#v}"

# Append short commit SHA so local builds are uniquely identifiable
# (e.g. 0.7.1-beta-4e155af). CI builds skip this — they build straight from
# the tagged commit and use the bare version.
SHORT_SHA="$(git rev-parse --short=7 HEAD 2>/dev/null || echo "")"
if [ -n "$SHORT_SHA" ]; then
    VERSION="${VERSION}-${SHORT_SHA}"
fi

echo "→ Building version $VERSION (from tag $TAG)"

# ---------- Backup / restore source files ----------

BACKUP_DIR="$(mktemp -d)"
restore() {
    for f in "${FILES[@]}"; do
        bkp="$BACKUP_DIR/$(echo "$f" | tr / _)"
        [ -f "$bkp" ] && cp "$bkp" "$f"
    done
    rm -rf "$BACKUP_DIR"
}
trap restore EXIT
for f in "${FILES[@]}"; do
    [ -f "$f" ] && cp "$f" "$BACKUP_DIR/$(echo "$f" | tr / _)"
done

# ---------- Apply version (mirrors build-release.yml) ----------

VERSION="$VERSION" python3 - <<'PY'
import json, re, os
version = os.environ['VERSION']

with open('src-tauri/tauri.conf.json', 'r+', encoding='utf-8') as f:
    d = json.load(f)
    d['version'] = version
    f.seek(0)
    json.dump(d, f, indent=4)
    f.truncate()

with open('src-tauri/Cargo.toml', 'r+', encoding='utf-8') as f:
    content = f.read()
    content = re.sub(r'^version\s*=\s*".*"', f'version = "{version}"', content, flags=re.MULTILINE)
    f.seek(0)
    f.write(content)
    f.truncate()

with open('frontend/index.js', 'r+', encoding='utf-8') as f:
    content = f.read()
    content = re.sub(r'APP_VERSION:\s*".*"', f'APP_VERSION: "{version}"', content)
    f.seek(0)
    f.write(content)
    f.truncate()
PY

# ---------- Build ----------

(cd src-tauri && cargo tauri build --runner cargo-xwin --target x86_64-pc-windows-msvc --no-bundle --ci)

# target-dir is overridden to "../target" in src-tauri/.cargo/config.toml,
# so the output sits at the repo root, not under src-tauri/.
EXE="target/x86_64-pc-windows-msvc/release/coinman-portfolio.exe"
if [ -f "$EXE" ]; then
    echo ""
    echo "✓ Built: $(realpath "$EXE")"
    echo "  Version: $VERSION"
fi
