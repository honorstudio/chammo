#!/usr/bin/env python3
"""다마고치 스프라이트를 시안 원본(docs/design-drafts/tamagotchi/body/*.py)에서 뽑아 src/ui/tama/sprites.ts 로.
실행: python3 scripts/gen-tama-sprites.py  — 시안에서 그림을 고치면 다시 돌린다"""
import json, pathlib, sys
ROOT = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'docs/design-drafts/tamagotchi/body'))
import sprites as V1, hires as H
from fire16 import FIRE
from others16 import WAVE, LEAF, STAR, HIDDEN, FUSED

# 알 고르기·무덤 공용 그림 + 계열별 16종(키 = 계열_자리) — 시안 v4·v5
S = {k: V1.S[k] for k in ['egg', 'grave']}
for egg, d in (('fire', FIRE), ('wave', WAVE), ('leaf', LEAF), ('star', STAR)):
    S.update({f'{egg}_{k}': v for k, v in d.items() if (egg, k) != ('fire', 'r1')})
    S[f'{egg}_cX'] = HIDDEN[egg]          # 숨은 성숙기
S.update({f'fuse_{k}': v for k, v in FUSED.items()})  # 합체 궁극체 — 계열 없음
S.update(bear=H.BEAR16, bear_blink=H.BEAR16_BLINK, bear_eat=H.BEAR16_EAT, bear_happy=H.BEAR16_HAPPY, bear_sick=H.BEAR16_SICK, **H.PROPS)
body = ',\n'.join(f'  {k}: {json.dumps(v, ensure_ascii=False)}' for k, v in S.items())
out = ROOT / 'app/src/ui/tama/sprites.ts'
out.write_text('// 자동 생성 — scripts/gen-tama-sprites.py. 손으로 고치지 말고 시안 원본을 고친 뒤 다시 돌린다.\n'
               "// '#' e m p = 켜진 화소, 바깥과 이어진 '.' = 투명, 갇힌 '.' = 몸통\n"
               f'export const SPR: Record<string, string[]> = {{\n{body},\n}};\n', encoding='utf-8')
print('written', out, len(S))
