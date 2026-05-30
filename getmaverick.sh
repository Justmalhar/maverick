#!/usr/bin/env sh
# Maverick installer — downloads the latest release asset for your platform.
#
#   curl -fsSL https://raw.githubusercontent.com/<owner>/<repo>/main/getmaverick.sh | sh
#
# Override the source repo or a pinned version:
#   MAVERICK_REPO=owner/repo MAVERICK_VERSION=v0.1.0 sh getmaverick.sh
#
# NOTE: this requires published GitHub Releases with assets named like
#   Maverick_<version>_<arch>.dmg / .AppImage / .deb / .msi
# Set MAVERICK_REPO to your actual release repository before publishing.
set -eu

REPO="${MAVERICK_REPO:-justmalhar/maverick}"
VERSION="${MAVERICK_VERSION:-latest}"

err() { printf 'error: %s\n' "$1" >&2; exit 1; }
info() { printf '\033[36m==>\033[0m %s\n' "$1"; }

command -v curl >/dev/null 2>&1 || err "curl is required"

os="$(uname -s)"
arch="$(uname -m)"
case "$arch" in
  arm64 | aarch64) arch="aarch64" ;;
  x86_64 | amd64) arch="x86_64" ;;
  *) err "unsupported architecture: $arch" ;;
esac

case "$os" in
  Darwin) ext="dmg"; platform="macOS" ;;
  Linux) ext="AppImage"; platform="Linux" ;;
  MINGW* | MSYS* | CYGWIN* | Windows_NT) ext="msi"; platform="Windows" ;;
  *) err "unsupported OS: $os" ;;
esac

info "Detected ${platform} (${arch})"

api="https://api.github.com/repos/${REPO}/releases/${VERSION}"
[ "$VERSION" = "latest" ] && api="https://api.github.com/repos/${REPO}/releases/latest"

info "Resolving release from ${REPO} (${VERSION})…"
asset_url="$(curl -fsSL "$api" \
  | grep -o "\"browser_download_url\": *\"[^\"]*\.${ext}\"" \
  | grep -i "$arch" \
  | head -n1 \
  | sed 's/.*"browser_download_url": *"\(.*\)"/\1/')"

# Fall back to any asset of the right extension if no arch-tagged match.
if [ -z "${asset_url:-}" ]; then
  asset_url="$(curl -fsSL "$api" \
    | grep -o "\"browser_download_url\": *\"[^\"]*\.${ext}\"" \
    | head -n1 \
    | sed 's/.*"browser_download_url": *"\(.*\)"/\1/')"
fi

[ -n "${asset_url:-}" ] || err "no .${ext} asset found in ${REPO} ${VERSION}"

out="$(basename "$asset_url")"
dest="${HOME}/Downloads"
[ -d "$dest" ] || dest="$(pwd)"

info "Downloading ${out}…"
curl -fSL "$asset_url" -o "${dest}/${out}"

info "Saved to ${dest}/${out}"
case "$platform" in
  macOS)   info "Open the .dmg and drag Maverick to /Applications." ;;
  Linux)   chmod +x "${dest}/${out}"; info "Run it: ${dest}/${out}" ;;
  Windows) info "Run the .msi installer: ${dest}/${out}" ;;
esac
