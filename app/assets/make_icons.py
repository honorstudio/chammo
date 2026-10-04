#!/usr/bin/env python3
"""앱 아이콘 전부를 한 원본에서 — 대표 캐릭터(첫 참모 기본 프사: 모찌 · #2f74e0 · 흰 알약 눈, domain/avatar BRAND).
시안 docs/design-drafts/app-icon v1 B(흰 판 + 파란 모찌) 확정(2026-10-03 사용자). 16·32 는 눈 1.3배 판.

    python3 app/assets/make_icons.py      # rsvg-convert·iconutil(맥)·Pillow 필요

찍는 것
  assets/icon*.svg                 원본(맥 격자 / 윈도우 꽉 찬 판 / 작은 크기용)
  src-tauri/icons/*                맥 icns · 윈도우 ico · 크기별 png · 윈도우 스토어 Square*  (tray*.png 는 손대지 않는다)
  public/assets/*                  폰 홈 화면 앱(manifest 192·512·maskable) · apple-touch-icon 180 · 파비콘 · 푸시 알림 그림
"""
import pathlib
import shutil
import subprocess
import tempfile

from PIL import Image

APP = pathlib.Path(__file__).resolve().parent.parent
ASSETS, ICONS, PUBLIC = APP / 'assets', APP / 'src-tauri' / 'icons', APP / 'public' / 'assets'

BLUE = '#2f74e0'  # BRAND.color
# ui/avatar/shapes.tsx mochi 몸·눈 자리 [높이, 가운데서 거리, 크기] — 눈은 pill: rx = r*0.44, ry = r*0.64
MOCHI = ('M20 7C27 7 31 11.5 32.2 17.5C33.2 22.5 36.5 25 36 29C35.4 33.5 29 34.5 20 34.5'
         'C11 34.5 4.6 33.5 4 29C3.5 25 6.8 22.5 7.8 17.5C9 11.5 13 7 20 7Z')
EYE_Y, EYE_DX, EYE_R = 22.5, 6.3, 5.2
BG = ('#ffffff', '#e9eef6')


def mochi(scale, cx, top, eye_k=1.0):
    """모찌 — 가운데 x=cx, 머리 꼭대기(y=7)를 top 에"""
    a, b = EYE_R * 0.44 * eye_k, EYE_R * 0.64 * eye_k
    eyes = ''.join(f'<ellipse cx="{20 + d * EYE_DX:.2f}" cy="{EYE_Y}" rx="{a:.3f}" ry="{b:.3f}" fill="#fff"/>' for d in (-1, 1))
    return f'<g transform="translate({cx - 20 * scale:.1f} {top - 7 * scale:.1f}) scale({scale})"><path d="{MOCHI}" fill="{BLUE}"/>{eyes}</g>'


GRAD = (f'<linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="{BG[0]}"/>'
        f'<stop offset="1" stop-color="{BG[1]}"/></linearGradient>')


# 맥 판 모양 = 1024 캔버스에 824 둥근 사각 rx185, 여백 100, 그림자 없음. 맥 26(Tahoe)은 이 모양을 벗어난 픽셀(바깥 그림자)이나
# 슈퍼타원처럼 조금 다른 모양이 있으면 아이콘을 회색 판 안에 한 번 더 가둔다 — 그림자는 맥이 스스로 그린다(2026-10-03 실측)
PLATE = '<rect x="100" y="100" width="824" height="824" rx="185"{a}/>'


def tile_icon(eye_k=1.0, mac=True):
    """판 위 캐릭터. mac = 격자 여백 / 아니면(윈도우·폰 any) 판이 캔버스를 거의 채운다"""
    view = '0 0 1024 1024' if mac else '96 96 832 832'
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{view}" width="1024" height="1024"><defs>{GRAD}</defs>'
            + PLATE.format(a=' fill="url(#g)"')
            + mochi(17.5, 512, 262, eye_k)
            + PLATE.format(a=' fill="none" stroke="#000" stroke-opacity=".06" stroke-width="2"') + '</svg>')


def full_bleed(scale):
    """판 없이 캔버스를 꽉 채운 바탕 — 폰이 스스로 모양을 깎는 자리(apple-touch-icon·maskable)"""
    top = 512 - (27.5 * scale) / 2 - 8 * scale / 17.5  # 모찌 높이 27.5 를 가운데로, 아래가 무거워 살짝 내림
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024"><defs>{GRAD}</defs>'
            f'<rect width="1024" height="1024" fill="url(#g)"/>{mochi(scale, 512, top)}</svg>')


def run(*cmd):
    subprocess.run(cmd, check=True)


def png(svg: pathlib.Path, out: pathlib.Path, px: int):
    run('rsvg-convert', '-w', str(px), '-h', str(px), '-o', str(out), str(svg))


def main():
    src = {
        'icon.svg': tile_icon(),                       # 맥 · 큰 크기
        'icon-small.svg': tile_icon(1.3),              # 맥 · 16·32pt
        'icon-win.svg': tile_icon(mac=False),          # 윈도우·폰 any — 판이 꽉 참
        'icon-win-small.svg': tile_icon(1.3, mac=False),
        'icon-bleed.svg': full_bleed(17.5 * 1.18),     # apple-touch-icon — iOS 가 둥글게 깎는다(맥 판 안 비율과 같게)
        'icon-maskable.svg': full_bleed(17.5 * 0.92),  # 안드로이드 maskable — 가운데 80% 원 안에
    }
    for name, svg in src.items():
        (ASSETS / name).write_text(svg, encoding='utf-8')
    a = lambda n: ASSETS / n
    png(a('icon.svg'), a('icon.png'), 1024)

    # 맥 icns — 16·32pt 칸(@2x 포함)은 눈 1.3배 판
    with tempfile.TemporaryDirectory() as tmp:
        iset = pathlib.Path(tmp) / 'icon.iconset'
        iset.mkdir()
        for pt in (16, 32, 128, 256, 512):
            for k, suffix in ((1, ''), (2, '@2x')):
                png(a('icon-small.svg' if pt <= 32 else 'icon.svg'), iset / f'icon_{pt}x{pt}{suffix}.png', pt * k)
        run('iconutil', '-c', 'icns', str(iset), '-o', str(ICONS / 'icon.icns'))

        # 윈도우 ico — 16·24·32 는 눈 1.3배
        parts = []
        for px in (256, 64, 48, 32, 24, 16):  # 큰 것이 먼저 — PIL 은 첫 그림보다 큰 칸을 버린다
            p = pathlib.Path(tmp) / f'ico{px}.png'
            png(a('icon-win-small.svg' if px <= 32 else 'icon-win.svg'), p, px)
            parts.append(str(p))
        # 칸마다 PNG 로(magick 은 256 을 압축 없는 BMP 로 넣어 300KB) — PIL 은 append_images 에서 크기가 맞는 그림을 쓴다
        imgs = [Image.open(p) for p in parts]
        imgs[0].save(ICONS / 'icon.ico', format='ICO', sizes=[i.size for i in imgs], append_images=imgs[1:])

    # tauri.conf 가 부르는 png(맥) · 윈도우 스토어 Square*
    for name, px, svg in (('32x32.png', 32, 'icon-small.svg'), ('64x64.png', 64, 'icon.svg'), ('128x128.png', 128, 'icon.svg'),
                          ('128x128@2x.png', 256, 'icon.svg'), ('icon.png', 512, 'icon.svg')):
        png(a(svg), ICONS / name, px)
    for px in (30, 44, 71, 89, 107, 142, 150, 284, 310):
        png(a('icon-win-small.svg' if px <= 44 else 'icon-win.svg'), ICONS / f'Square{px}x{px}Logo.png', px)
    png(a('icon-win.svg'), ICONS / 'StoreLogo.png', 50)

    # 폰 홈 화면 앱 — 폰 서버는 /assets/ 한 단계만 내준다(mobile_http asset_path)
    PUBLIC.mkdir(parents=True, exist_ok=True)
    png(a('icon-win.svg'), PUBLIC / 'icon-192.png', 192)
    png(a('icon-win.svg'), PUBLIC / 'icon-512.png', 512)
    png(a('icon-maskable.svg'), PUBLIC / 'icon-maskable-512.png', 512)
    png(a('icon-bleed.svg'), PUBLIC / 'apple-touch-icon.png', 180)
    png(a('icon-win-small.svg'), PUBLIC / 'favicon-32.png', 32)
    shutil.copy(a('icon-win-small.svg'), PUBLIC / 'favicon.svg')


if __name__ == '__main__':
    main()
