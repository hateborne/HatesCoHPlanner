#!/bin/bash
# Fetch the planner's newest release and switch the site on this host to it (docs/hosting.md).
#
# The deploy attaches the site, built for the root path, to each GitHub release (planner-site.tar.gz
# with its .sha256 and its .sig). This script asks GitHub which release is the newest, and when that
# is newer than the one the site is on it downloads the file, checks it, unpacks it beside the site
# and switches over in one step. Anything that goes wrong leaves the site as it was. GitHub holds no
# key to this host, and the repository doesn't hold the host's address.
#
# A file is installed only with a signature for its own release by the deploy's signing key, whose
# public half is in $SIGNERS (docs/hosting.md, "The site file's signature"). Only a deploy from main
# can sign, so a release or a file put up by anything else (a workflow on another branch with a
# write token, say) is refused, and so is one release's file attached to another.
#
#   planner-update                      fetch the newest release (the timer runs this)
#   planner-update --file FILE NAME     install a site file already on this host, as release NAME
#   planner-update --to NAME            switch to a release still kept on this host (to go back)
#
# Runs as the site's own user, not root. PLANNER_ROOT names the site's folder (default /srv/planner).
set -euo pipefail

REPO="https://github.com/hateborne/HatesCoHPlanner"
ASSET="planner-site.tar.gz"
ROOT="${PLANNER_ROOT:-/srv/planner}"
SIGNERS="${PLANNER_SIGNERS:-/etc/planner-update/allowed_signers}"  # the signing key's public half
SIGNER="planner-release"                                             # its name in that file
KEEP=2                # releases kept beside the current one, to go back to by hand
MAX_BYTES=524288000   # no site file is near this (500 MB): a larger one is refused
MIN_FREE_KB=1048576   # room the disk must have before a download (1 GB)
VERSION='^v[0-9]+\.[0-9]+\.[0-9]+$'               # a release's name, as the deploy tags it
HTTPS=(--proto '=https' --proto-redir '=https')   # curl asks over https only, redirects included

say() { echo "planner-update: $*"; }
fail() { echo "planner-update: $*" >&2; exit 1; }
usage() { fail "usage: planner-update [--file FILE NAME | --to NAME]"; }

# @param $1 A release name; only letters, digits, dots, dashes and underscores make a folder name.
safe_name() { [[ "$1" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$ ]]; }

# @return The release the site is on ("" when none is installed yet), however its link is written.
current() {
  local to
  to="$(readlink "$ROOT/current" 2>/dev/null || true)"
  if [ -n "$to" ]; then basename "$to"; fi
}

# @param $1 A version (vX.Y.Z).
# @param $2 Another.
# @return 0 when the first is the newer of the two.
newer() {
  local a b i
  IFS=. read -r -a a <<< "${1#v}"
  IFS=. read -r -a b <<< "${2#v}"
  for i in 0 1 2; do
    if (( 10#${a[i]} > 10#${b[i]} )); then return 0; fi
    if (( 10#${a[i]} < 10#${b[i]} )); then return 1; fi
  done
  return 1
}

# Point the site at an unpacked release: a new link renamed over the old one, so every request sees
# one release or the other.
# @param $1 The release's name (a folder under releases/).
switch_to() {
  ln -s "releases/$1" "$ROOT/current.new"
  mv -T "$ROOT/current.new" "$ROOT/current"
  say "the site is now on $1"
}

# Unpack a site file into a new folder under $ROOT/tmp.
# @param $1 The site file (a gzipped tar).
# @param $2 The folder to make.
unpack() {
  mkdir "$2"
  tar -xzf "$1" -C "$2" --no-same-owner --no-same-permissions
}

# Check an unpacked site, move it into place and switch the site to it.
# @param $1 The folder it was unpacked into (under $ROOT/tmp).
# @param $2 The release's name.
install_site() {
  local site="$1" name="$2" odd f
  # only plain files and folders: a link could point outside the site, and the web server would follow it
  odd="$(find "$site" ! -type f ! -type d -print -quit)"
  [ -z "$odd" ] || fail "release $name holds something that is not a plain file or folder; the site stays as it was"
  for f in index.html 404.html data/versions.json; do
    [ -s "$site/$f" ] || fail "release $name has no $f; the site stays as it was"
  done
  chmod -R u=rwX,go=rX "$site"
  mkdir -p "$ROOT/releases"
  # a folder of that name left by an earlier run is replaced, but never the one being served
  [ "$name" != "$(current)" ] || fail "the site is on $name: it is not replaced while it is served"
  rm -rf "${ROOT:?}/releases/$name"
  mv "$site" "$ROOT/releases/$name"
  touch "$ROOT/releases/$name" # the newest folder is the one installed last (prune goes by this)
  switch_to "$name"
}

# Remove all but the current release and the $KEEP newest others.
prune() {
  local now dir n=0
  now="$(current)"
  while IFS= read -r dir; do
    [ "$(basename "$dir")" = "$now" ] && continue
    n=$((n + 1))
    if [ "$n" -gt "$KEEP" ]; then rm -rf "$dir"; fi
  done < <(ls -1dt "$ROOT"/releases/*/ 2>/dev/null)
}

# Fetch the newest release, when it is newer than the one the site is on.
fetch() {
  local tmp="$ROOT/tmp" name now answer free code want got
  # the newest release's name: GitHub answers /releases/latest with a redirect to it
  answer="$(curl -fsSI "${HTTPS[@]}" --max-time 30 "$REPO/releases/latest")" || fail "GitHub did not answer; the site stays as it was"
  name="$(printf '%s\n' "$answer" | tr -d '\r' | sed -n 's|^[Ll]ocation: .*/releases/tag/||p' | tail -n 1)"
  [[ "$name" =~ $VERSION ]] || fail "GitHub named no release (got \"$name\"); the site stays as it was"
  now="$(current)"
  [ "$name" != "$now" ] || return 0
  # The site only moves forward on its own. A link made here on a newer release may need a game
  # version an older one doesn't have, so going back is the owner's call (--to), never GitHub's.
  if [[ "$now" =~ $VERSION ]] && ! newer "$name" "$now"; then
    say "GitHub's newest release is $name, older than the site's $now; the site stays on $now (it goes back by hand only: --to)"
    return 0
  fi

  free="$(df -Pk "$ROOT" | awk 'NR==2 {print $4}')"
  [ "$free" -ge "$MIN_FREE_KB" ] || fail "the disk has too little room for $name; the site stays as it was"
  code="$(curl -sSL "${HTTPS[@]}" --max-time 900 --max-filesize "$MAX_BYTES" -o "$tmp/$ASSET" -w '%{http_code}' "$REPO/releases/download/$name/$ASSET")" \
    || fail "the download of release $name failed; the site stays as it was"
  # No file: the deploy attaches it some minutes after the release is published, and not at all
  # when its stage for this site failed (or for a release from before there was one). Nothing to
  # do but look again next time.
  if [ "$code" = 404 ]; then
    say "release $name carries no site file; the site stays on ${now:-nothing}"
    return 0
  fi
  [ "$code" = 200 ] || fail "GitHub answered $code for release $name's site file; the site stays as it was"
  curl -fsSL "${HTTPS[@]}" --max-time 60 --max-filesize 4096 -o "$tmp/$ASSET.sha256" "$REPO/releases/download/$name/$ASSET.sha256" \
    || fail "release $name has no checksum; the site stays as it was"
  # the checksum the release names against the file's own, whatever else that small file says
  want="$(awk 'NR==1 {print $1}' "$tmp/$ASSET.sha256")"
  got="$(sha256sum "$tmp/$ASSET" | awk '{print $1}')"
  [[ "$want" =~ ^[0-9a-f]{64}$ ]] && [ "$want" = "$got" ] || fail "release $name does not match its checksum; the site stays as it was"
  # signed for this very release (the namespace names it), by the deploy's key
  curl -fsSL "${HTTPS[@]}" --max-time 60 --max-filesize 4096 -o "$tmp/$ASSET.sig" "$REPO/releases/download/$name/$ASSET.sig"     || fail "release $name has no signature; the site stays as it was"
  ssh-keygen -Y verify -f "$SIGNERS" -I "$SIGNER" -n "planner-site-$name" -s "$tmp/$ASSET.sig" < "$tmp/$ASSET" > /dev/null     || fail "release $name is not signed by the deploy's key; the site stays as it was"
  unpack "$tmp/$ASSET" "$tmp/site" || fail "release $name could not be unpacked; the site stays as it was"
  install_site "$tmp/site" "$name"
  prune
}

main() {
  local mode="fetch" file="" name=""
  case "${1:-}" in
    "") [ $# -eq 0 ] || usage ;;
    --file)
      [ $# -eq 3 ] || usage
      mode="file"; name="$3"
      # its full path, before this moves to the site's folder
      file="$(realpath -e -- "$2" 2>/dev/null)" && [ -f "$file" ] || fail "$2 is not a file the site's user can reach"
      ;;
    --to)
      [ $# -eq 2 ] || usage
      mode="to"; name="$2"
      ;;
    *) usage ;;
  esac
  if [ "$mode" != "fetch" ]; then
    safe_name "$name" || fail "\"$name\" can't name a release (letters, digits, dots, dashes, underscores)"
  fi

  [ -d "$ROOT" ] || fail "$ROOT does not exist"
  # as the folder's owner only: a file root left in it would stop every later run
  [ -O "$ROOT" ] || fail "run this as the user $ROOT belongs to (sudo -u planner planner-update ...)"
  # without the key nothing fetched could be trusted (a file installed by hand needs none)
  if [ "$mode" = "fetch" ]; then
    [ -s "$SIGNERS" ] || fail "$SIGNERS is missing, so no release can be checked; the site stays as it was"
  fi
  # work from the site's folder: the one this was started in may be closed to the site's user
  cd "$ROOT"
  # one run at a time
  exec 9>"$ROOT/.lock"
  flock -n 9 || fail "another run is in progress"
  rm -rf "$ROOT/tmp" "$ROOT/current.new"
  mkdir "$ROOT/tmp"
  trap 'rm -rf "$ROOT/tmp" "$ROOT/current.new"' EXIT

  case "$mode" in
    fetch) fetch ;;
    file)
      [ "$name" != "$(current)" ] || fail "the site is on $name: install it under another name"
      unpack "$file" "$ROOT/tmp/site" || fail "$file could not be unpacked; the site stays as it was"
      install_site "$ROOT/tmp/site" "$name"
      prune
      ;;
    to)
      [ "$name" != "$(current)" ] || fail "the site is on $name already"
      [ -s "$ROOT/releases/$name/index.html" ] || fail "release $name is not kept here (kept: $(ls "$ROOT/releases" 2>/dev/null | tr '\n' ' '))"
      switch_to "$name"
      ;;
  esac
}

main "$@"
