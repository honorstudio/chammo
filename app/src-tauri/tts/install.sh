#!/bin/bash
# Chammo Supertonic 받기 — install.sh <설치 폴더>. 파이썬 패키지(약 125MB) + 목소리 모델(약 385MB)
set -euo pipefail
DIR="$1"
rm -f "$DIR/ready"
python3 -m venv "$DIR/venv"
"$DIR/venv/bin/pip" install -q --disable-pip-version-check supertonic numpy
# 한 번 읽어 보며 모델을 받는다 — 여기서 실패하면 준비 안 된 걸로 둔다
CHECK="$(mktemp -t chammo-tts-check)"
"$DIR/venv/bin/python" "$DIR/say.py" "$CHECK.wav" M1 "준비됐어요"
rm -f "$CHECK" "$CHECK.wav"
touch "$DIR/ready"
