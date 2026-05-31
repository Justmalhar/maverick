#!/usr/bin/env sh
# Maverick installer — downloads and verifies the latest release asset for your platform.
#
#   curl -fsSL https://raw.githubusercontent.com/<owner>/<repo>/main/getmaverick.sh | sh
#
# Override the source repo or a pinned version:
#   MAVERICK_REPO=owner/repo MAVERICK_VERSION=v0.1.0 sh getmaverick.sh
#
# Skip checksum verification ONLY for local smoke tests (NOT recommended):
#   MAVERICK_INSECURE_SKIP_VERIFY=1 sh getmaverick.sh
#
# Security: this script refuses to install an artifact it cannot verify. It
# requires a companion `<asset>.sha256` (a `sha256sum`-style line, or a bare hash)
# published next to the asset, computes the SHA-256 of the download, and aborts —
# deleting the partial file — on mismatch or when no checksum is present.
#
# The Tauri `latest.json` updater manifest is NOT treated as proof of integrity:
# its minisign signature can only be verified with the app's embedded public key
# by the in-app updater, not by this script. So a release with only `latest.json`
# (no `.sha256`) is considered unverifiable here — install via the in-app updater,
# or override with MAVERICK_INSECURE_SKIP_VERIFY=1 if you accept the risk.
#
# NOTE: this requires published GitHub Releases with assets named like
#   Maverick_<version>_<arch>.dmg / .AppImage / .deb / .msi
# Set MAVERICK_REPO to your actual release repository before publishing.
set -eu

REPO="${MAVERICK_REPO:-justmalhar/maverick}"
VERSION="${MAVERICK_VERSION:-latest}"
SKIP_VERIFY="${MAVERICK_INSECURE_SKIP_VERIFY:-0}"

err() { printf '\033[31merror:\033[0m %s\n' "$1" >&2; exit 1; }
warn() { printf '\033[33mwarn:\033[0m %s\n' "$1" >&2; }
info() { printf '\033[36m==>\033[0m %s\n' "$1"; }

command -v curl >/dev/null 2>&1 || err "curl is required"

# A SHA-256 tool is mandatory unless verification is explicitly skipped.
SHA_TOOL=""
if command -v sha256sum >/dev/null 2>&1; then
  SHA_TOOL="sha256sum"
elif command -v shasum >/dev/null 2>&1; then
  SHA_TOOL="shasum -a 256"
fi

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
# Fetch the release JSON once. A 404 (or any non-asset payload) means the release
# was never published — fail clearly instead of downloading nothing useful.
release_json="$(curl -fsSL "$api" 2>/dev/null)" \
  || err "release ${VERSION} not found in ${REPO} (is it published?)"

printf '%s' "$release_json" | grep -q '"assets"' \
  || err "release ${VERSION} in ${REPO} has no assets array (not a real release)"

# Extract every browser_download_url once so we can resolve the asset AND its
# companion checksum from the same payload.
urls="$(printf '%s' "$release_json" \
  | grep -o '"browser_download_url": *"[^"]*"' \
  | sed 's/.*"browser_download_url": *"\(.*\)"/\1/')"

# Prefer an arch-tagged asset of the right extension; fall back to any of that ext.
asset_url="$(printf '%s' "$urls" | grep "\.${ext}\$" | grep -i "$arch" | head -n1)"
[ -n "$asset_url" ] || asset_url="$(printf '%s' "$urls" | grep "\.${ext}\$" | head -n1)"
[ -n "$asset_url" ] || err "no .${ext} asset found in ${REPO} ${VERSION}"

out="$(basename "$asset_url")"
checksum_url="$(printf '%s' "$urls" | grep -F "${out}.sha256" | head -n1)"

dest="${HOME}/Downloads"
[ -d "$dest" ] || dest="$(pwd)"

# Delete the partially/unverified download before failing, so we never leave an
# artifact we refused to vouch for sitting in the user's Downloads folder.
cleanup_and_fail() {
  rm -f "${dest}/${out}"
  err "$1"
}

info "Downloading ${out}…"
curl -fSL "$asset_url" -o "${dest}/${out}" || err "download failed: ${asset_url}"

verify_sha256() {
  # $1 = expected hex hash. Compares against the freshly computed digest.
  [ -n "$SHA_TOOL" ] || cleanup_and_fail "no sha256 tool (install coreutils or shasum) — cannot \
verify; re-run with MAVERICK_INSECURE_SKIP_VERIFY=1 only if you accept the risk"
  actual="$($SHA_TOOL "${dest}/${out}" | awk '{print $1}')"
  expected="$(printf '%s' "$1" | tr 'A-F' 'a-f')"
  actual="$(printf '%s' "$actual" | tr 'A-F' 'a-f')"
  [ "$actual" = "$expected" ] \
    || cleanup_and_fail "checksum mismatch for ${out} (expected ${expected}, got ${actual}) — refusing to install"
  info "Checksum OK (sha256)."
}

if [ "$SKIP_VERIFY" = "1" ]; then
  warn "MAVERICK_INSECURE_SKIP_VERIFY=1 set — skipping integrity verification."
elif [ -n "$checksum_url" ]; then
  info "Verifying integrity against ${out}.sha256…"
  # The checksum file may be a `sha256sum`-style "<hash>  <file>" line or a bare hash.
  expected_hash="$(curl -fsSL "$checksum_url" | awk '{print $1}' | head -n1)"
  [ -n "$expected_hash" ] || cleanup_and_fail "checksum file ${out}.sha256 was empty"
  verify_sha256 "$expected_hash"
else
  # No per-asset checksum. The Tauri latest.json manifest (if any) carries a
  # minisign signature this script cannot verify without the app's embedded
  # pubkey, so we do NOT treat its presence as integrity. Refuse rather than
  # install an unverifiable artifact.
  cleanup_and_fail "no ${out}.sha256 companion published for ${VERSION} — refusing to install an \
unverified artifact. Use the in-app updater (signature-verified), or override with \
MAVERICK_INSECURE_SKIP_VERIFY=1 if you accept the risk."
fi

info "Saved to ${dest}/${out}"
case "$platform" in
  macOS)   info "Open the .dmg and drag Maverick to /Applications." ;;
  Linux)   chmod +x "${dest}/${out}"; info "Run it: ${dest}/${out}" ;;
  Windows) info "Run the .msi installer: ${dest}/${out}" ;;
esac
