#!/bin/bash
# 말 앞단 Claude API 실측(키즈 일곱째 조각) — 손 뗌 → 첫 대답 소리, 20번, 목표 p90 2초.
# 먼저 앱 설정 > 키즈 모드 '빠른 대답'에 API 키를 넣는다(키체인). 키가 없으면 시험이 멈춘다 — 키를 지어내지 않는다.
# 시험 데이터 폴더는 임시(CHAMMO_HOME), 받아쓰기·목소리 모델만 진짜 데이터 폴더에서 빌려 쓴다(링크, 읽기만).
# 녹음: KIDS_WAVS(16kHz 모노 wav 폴더), 없으면 본 저장소 .shots/kids-api/wavs
set -euo pipefail
cd "$(dirname "$0")/../../src-tauri"
ROOT=$(cd "$(git rev-parse --git-common-dir)/.." && pwd)
WAVS=${KIDS_WAVS:-$ROOT/.shots/kids-api/wavs}
DATA=${CHAMMO_REAL_DATA:-$HOME/.honor-orchestrator}
H=$(mktemp -d)/home
mkdir -p "$H"
echo '{"features":{"kids":true}}' > "$H/config.json"
ln -s "$DATA/stt" "$H/stt"
ln -s "$DATA/tts" "$H/tts"
KIDS_WAVS=$WAVS CHAMMO_HOME=$H CHAMMO_NO_OS_NOTIFY=1 CHAMMO_KIDS_API_REAL=1 \
  cargo test -j 4 kids_pad::real_api_speed -- --ignored --test-threads=1 --nocapture
python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); print("API 앞단 첫 대답 소리 p50", d["p50"], "ms · p90", d["p90"], "ms (목표 p90 2000)")' "$H/api-speed.json"
