#!/bin/sh
#
# Fetches the gitleaks binary the pre-commit hook uses.
#
# Pinned to the same version `.github/workflows/security.yml` runs, because a
# hook that catches something CI does not — or misses something CI catches — is
# worse than no hook: it teaches people that a local pass means nothing.
#
# The download is checksum-verified. Fetching a secret scanner over the network
# and trusting whatever comes back would be its own supply-chain hole, and this
# is the one tool where that irony is least affordable.
#
# Installs into `.git/hooks-bin/`, which is outside the working tree, so the
# binary is never a candidate for being committed and needs no ignore rule.
set -eu

VERSION=8.28.0

git rev-parse --git-dir >/dev/null 2>&1 || {
  echo "not inside a git repository" >&2
  exit 1
}
BIN_DIR="$(git rev-parse --git-dir)/hooks-bin"
TARGET="$BIN_DIR/gitleaks"

if [ -x "$TARGET" ] && "$TARGET" version 2>/dev/null | grep -q "$VERSION"; then
  echo "gitleaks $VERSION already installed at $TARGET"
  exit 0
fi

case "$(uname -s)" in
  Darwin) os=darwin ;;
  Linux) os=linux ;;
  *) echo "unsupported operating system: $(uname -s)" >&2; exit 1 ;;
esac

case "$(uname -m)" in
  arm64 | aarch64) arch=arm64 ;;
  x86_64 | amd64) arch=x64 ;;
  *) echo "unsupported architecture: $(uname -m)" >&2; exit 1 ;;
esac

archive="gitleaks_${VERSION}_${os}_${arch}.tar.gz"
base="https://github.com/gitleaks/gitleaks/releases/download/v${VERSION}"

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

echo "downloading $archive"
curl -sSfL "$base/$archive" -o "$tmp/$archive"
curl -sSfL "$base/gitleaks_${VERSION}_checksums.txt" -o "$tmp/checksums.txt"

# Compare against the published checksum before unpacking anything.
expected="$(grep " $archive\$" "$tmp/checksums.txt" | awk '{print $1}')"
if [ -z "$expected" ]; then
  echo "no published checksum for $archive" >&2
  exit 1
fi

if command -v sha256sum >/dev/null 2>&1; then
  actual="$(sha256sum "$tmp/$archive" | awk '{print $1}')"
else
  actual="$(shasum -a 256 "$tmp/$archive" | awk '{print $1}')"
fi

if [ "$expected" != "$actual" ]; then
  echo "checksum mismatch for $archive" >&2
  echo "  expected $expected" >&2
  echo "  actual   $actual" >&2
  exit 1
fi

mkdir -p "$BIN_DIR"
tar -xzf "$tmp/$archive" -C "$tmp" gitleaks
mv "$tmp/gitleaks" "$TARGET"
chmod +x "$TARGET"

echo "installed $("$TARGET" version) at $TARGET"
