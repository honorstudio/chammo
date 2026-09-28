#!/usr/bin/env bash
# Chammo 릴리스 빌드 — Developer ID 로 서명하고 Apple 공증까지 받아 더블클릭으로 열리는 DMG 를 만든다.
# Release build — signs with a Developer ID and notarizes, so the DMG opens with a double-click.
#
#   APPLE_SIGNING_IDENTITY="Developer ID Application: <Name> (<TEAM>)" \
#   APPLE_API_KEY=<key id> APPLE_API_ISSUER=<issuer uuid> APPLE_API_KEY_PATH=<AuthKey_xxx.p8> \
#   scripts/release-mac.sh
# or, with a notarytool keychain profile (xcrun notarytool store-credentials <name> --key … --key-id … --issuer …):
#   APPLE_SIGNING_IDENTITY="…" APPLE_NOTARY_PROFILE=<name> scripts/release-mac.sh
#
# 서명 없이 직접 빌드할 땐 이 스크립트가 필요 없다(app 에서 pnpm tauri build — ad-hoc 서명).
# 공증 키는 App Store Connect > 사용자 및 액세스 > 통합 > App Store Connect API 에서 만든다(Developer 역할 이상).
set -euo pipefail

: "${APPLE_SIGNING_IDENTITY:?Developer ID Application 인증서 이름이 필요해요 (security find-identity -v -p codesigning)}"
PROFILE="${APPLE_NOTARY_PROFILE:-}"
if [ -z "$PROFILE" ]; then
  : "${APPLE_API_KEY:?App Store Connect API 키 ID 가 필요해요 (또는 APPLE_NOTARY_PROFILE)}"
  : "${APPLE_API_ISSUER:?App Store Connect API issuer ID 가 필요해요}"
  : "${APPLE_API_KEY_PATH:?AuthKey_*.p8 경로가 필요해요}"
  export APPLE_API_KEY APPLE_API_ISSUER APPLE_API_KEY_PATH
fi
export APPLE_SIGNING_IDENTITY
# 실행 파일에 빌드한 맥의 절대경로(/Users/<이름>/…)가 에러 메시지로 박히지 않게
export RUSTFLAGS="--remap-path-prefix=$HOME=~ ${RUSTFLAGS:-}"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BUNDLE="$ROOT/app/src-tauri/target.noindex/release/bundle"  # .cargo/config.toml 의 target-dir

# 1) 빌드 — Tauri 가 .app 을 서명하고(hardened runtime) 공증·스테이플한 뒤 DMG 를 만든다
cd "$ROOT/app"
pnpm tauri build

APP="$BUNDLE/macos/Chammo.app"
DMG="$(ls -t "$BUNDLE"/dmg/Chammo_*.dmg | head -1)"

# 2) DMG 자체도 서명·공증·스테이플 — 받은 파일을 열 때 인터넷 확인 없이도 통과하게
#    키체인 프로필이면 Tauri 는 공증을 건너뛰므로 DMG 공증이 안의 앱까지 함께 받는다(앱은 그 티켓으로 스테이플)
codesign --force --sign "$APPLE_SIGNING_IDENTITY" --timestamp "$DMG"
if [ -n "$PROFILE" ]; then
  xcrun notarytool submit "$DMG" --keychain-profile "$PROFILE" --wait
  xcrun stapler staple "$APP"
else
  xcrun notarytool submit "$DMG" --key "$APPLE_API_KEY_PATH" --key-id "$APPLE_API_KEY" --issuer "$APPLE_API_ISSUER" --wait
fi
xcrun stapler staple "$DMG"

# 3) 확인 — Gatekeeper 가 받아 주는지
spctl -a -vv "$APP"
spctl -a -vv -t open --context context:primary-signature "$DMG"
echo
echo "완료 / Done: $DMG"
