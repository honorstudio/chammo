#!/usr/bin/env bash
# Chammo installer / 설치 스크립트
#
#   curl -fsSL https://raw.githubusercontent.com/honorstudio/chammo/main/scripts/install.sh | bash
#   bash install.sh --yes      # replace an existing /Applications/Chammo.app without asking
#                              # 이미 있는 Chammo.app 을 묻지 않고 바꾼다
#
# What it does / 하는 일:
#   1. finds the latest release on GitHub and downloads its .dmg   (최신 릴리스의 .dmg 받기)
#   2. copies Chammo.app into /Applications                        (응용 프로그램 폴더에 복사)
#   3. clears the download quarantine flag and opens the app       (격리 표시를 지우고 실행)
# After it opens, Chammo walks you through installing Claude Code and signing in.
# 앱이 열리면 Claude Code 설치·로그인은 앱 안에서 차례로 안내해요.
set -euo pipefail

REPO="honorstudio/chammo"
APP_NAME="Chammo.app"
DEST_DIR="/Applications"
DEST="$DEST_DIR/$APP_NAME"
YES=0

# ── 말하기: 시스템 언어가 한국어면 한국어로 ─────────────────────────
# LANG 이 정해져 있으면 그것, 비었거나 C 면 macOS 지역 설정(AppleLocale)
KO=0
case "${LANG:-}" in
  ko*) KO=1 ;;
  ""|C|C.*|POSIX)
    if command -v defaults >/dev/null 2>&1; then
      case "$(defaults read -g AppleLocale 2>/dev/null || true)" in ko*) KO=1 ;; esac
    fi ;;
esac
msg() { if [ "$KO" = 1 ]; then printf '%s' "$1"; else printf '%s' "$2"; fi; }
step() { printf '\n\033[1m==> %s\033[0m\n' "$(msg "$1" "$2")"; }
info() { printf '    %s\n' "$(msg "$1" "$2")"; }
die() { printf '\n\033[31m%s\033[0m\n' "$(msg "$1" "$2")" >&2; exit 1; }

usage() {
  msg "사용법: install.sh [--yes]
  --yes   이미 설치된 Chammo 를 묻지 않고 새 버전으로 바꿔요
" "Usage: install.sh [--yes]
  --yes   replace an existing Chammo without asking
"
}

for arg in "$@"; do
  case "$arg" in
    -y|--yes) YES=1 ;;
    -h|--help) usage; exit 0 ;;
    *) usage >&2; die "모르는 옵션이에요: $arg" "Unknown option: $arg" ;;
  esac
done

# ── 준비물 확인 ─────────────────────────────────────────────────
[ "$(uname -s)" = "Darwin" ] || die "Chammo 는 macOS 전용이에요." "Chammo runs on macOS only."
for cmd in curl hdiutil ditto xattr open; do
  command -v "$cmd" >/dev/null 2>&1 || die "필요한 명령이 없어요: $cmd" "A required command is missing: $cmd"
done

TMP="$(mktemp -d -t chammo-install)"
MNT="$TMP/mnt"
cleanup() {
  if [ -d "$MNT" ] && mount | grep -q " on $MNT "; then hdiutil detach "$MNT" -quiet -force >/dev/null 2>&1 || true; fi
  rm -rf "$TMP"
}
trap cleanup EXIT

# ── 1. 최신 릴리스 찾기 ───────────────────────────────────────────
step "최신 버전을 찾는 중이에요…" "Looking for the latest release…"
API="https://api.github.com/repos/$REPO/releases/latest"
JSON="$(curl -fsSL -H 'Accept: application/vnd.github+json' "$API")" \
  || die "GitHub 에서 릴리스 정보를 못 받았어요. 인터넷 연결을 확인하고 다시 해 주세요." \
         "Could not reach GitHub for release info. Check your internet connection and try again."

URLS="$(printf '%s\n' "$JSON" | grep -o '"browser_download_url"[[:space:]]*:[[:space:]]*"[^"]*\.dmg"' | sed 's/.*"\(https[^"]*\)"$/\1/' || true)"
[ -n "$URLS" ] || die "최신 릴리스에 .dmg 파일이 없어요. https://github.com/$REPO/releases 에서 직접 받아 주세요." \
                      "The latest release has no .dmg file. Please download it from https://github.com/$REPO/releases"

# 이 맥의 칩에 맞는 것 먼저(Apple 칩 = aarch64/arm64, 인텔 = x64), 없으면 universal, 그것도 없으면 첫 번째
case "$(uname -m)" in
  arm64) PREFER='aarch64|arm64' ;;
  *) PREFER='x64|x86_64|intel' ;;
esac
URL="$(printf '%s\n' "$URLS" | grep -Ei "$PREFER" | head -n 1 || true)"
[ -n "$URL" ] || URL="$(printf '%s\n' "$URLS" | grep -i 'universal' | head -n 1 || true)"
[ -n "$URL" ] || URL="$(printf '%s\n' "$URLS" | head -n 1)"
TAG="$(printf '%s\n' "$JSON" | grep -o '"tag_name"[[:space:]]*:[[:space:]]*"[^"]*"' | head -n 1 | sed 's/.*"\([^"]*\)"$/\1/' || true)"
info "버전: ${TAG:-?}" "Version: ${TAG:-?}"
info "파일: ${URL##*/}" "File: ${URL##*/}"

# ── 2. 받기 ────────────────────────────────────────────────────
step "내려받는 중이에요…" "Downloading…"
curl -fL --progress-bar -o "$TMP/Chammo.dmg" "$URL" \
  || die "내려받기에 실패했어요. 잠시 뒤에 다시 해 주세요." "The download failed. Please try again in a moment."

# ── 3. 열어서 앱 찾기 ────────────────────────────────────────────
step "디스크 이미지를 여는 중이에요…" "Opening the disk image…"
mkdir -p "$MNT"
hdiutil attach "$TMP/Chammo.dmg" -nobrowse -readonly -noautoopen -mountpoint "$MNT" -quiet \
  || die "디스크 이미지를 열지 못했어요. 파일이 깨졌을 수 있어요 — 다시 실행해 주세요." \
         "Could not open the disk image. The file may be damaged — please run this again."
SRC="$MNT/$APP_NAME"
if [ ! -d "$SRC" ]; then
  SRC="$(find "$MNT" -maxdepth 1 -name '*.app' -print -quit)"
  [ -n "$SRC" ] || die "디스크 이미지 안에 앱이 없어요." "No app was found inside the disk image."
fi

# ── 4. 응용 프로그램 폴더로 복사 ───────────────────────────────────
SUDO=""
if [ ! -w "$DEST_DIR" ]; then
  SUDO="sudo"
  info "응용 프로그램 폴더에 쓰려면 맥 암호가 필요해요." "Your Mac password is needed to write to the Applications folder."
fi

if [ -d "$DEST" ]; then
  if [ "$YES" != 1 ]; then
    if [ -r /dev/tty ]; then
      printf '\n%s ' "$(msg "이미 $DEST 가 있어요. 새 버전으로 바꿀까요? [y/N]" "$DEST already exists. Replace it with the new version? [y/N]")"
      read -r answer </dev/tty || answer=""
      case "$answer" in y|Y|yes|YES|Yes|예|네|ㅇ) ;; *) die "그대로 뒀어요. 바꾸려면 --yes 를 붙여 다시 실행해 주세요." "Left it as it was. Run again with --yes to replace it." ;; esac
    else
      die "이미 $DEST 가 있어요. 바꾸려면 --yes 를 붙여 다시 실행해 주세요." "$DEST already exists. Run again with --yes to replace it."
    fi
  fi
  if pgrep -x "Chammo" >/dev/null 2>&1; then
    info "켜져 있는 Chammo 를 끄는 중이에요…" "Quitting the running Chammo…"
    osascript -e 'quit app "Chammo"' >/dev/null 2>&1 || true
    sleep 2
  fi
  step "이전 버전을 치우는 중이에요…" "Removing the previous version…"
  $SUDO rm -rf "$DEST"
fi

step "응용 프로그램 폴더에 넣는 중이에요…" "Copying to the Applications folder…"
$SUDO ditto "$SRC" "$DEST" || die "복사에 실패했어요." "Copying failed."

hdiutil detach "$MNT" -quiet >/dev/null 2>&1 || true

# 인터넷에서 받은 앱 표시(격리)를 지운다 — 서명 안 된 공개판이라 안 지우면 macOS 가 "열 수 없음"으로 막는다
$SUDO xattr -dr com.apple.quarantine "$DEST" 2>/dev/null || true

# ── 5. 열기 ────────────────────────────────────────────────────
step "다 됐어요. Chammo 를 여는 중이에요." "All set. Opening Chammo."
info "처음 열면 설정 화면이 Claude Code 설치·로그인까지 차례로 안내해요." "On first launch, the setup screen walks you through installing Claude Code and signing in."
open "$DEST"
