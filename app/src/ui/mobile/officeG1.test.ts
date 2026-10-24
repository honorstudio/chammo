// "G1이 좋은데 딱 저거 활성화된 동안 채팅창 사라지면 될 듯 더 공간 쓰게. 뽑기랑 스킨 아이콘화하고."(2026-10-24 사용자 폰)
// 시안 office-fit v2 G1 인벤토리 가방 + P2(시트 틀·장착 연출·되돌리기 아이콘·작은 폰은 열리면 참모 줄 숨김)
import { describe, expect, it } from 'vitest';
import css from './mobile.css?raw';
import office from './PhoneOffice.tsx?raw';
import gacha from './PhoneGacha.tsx?raw';
import app from './MobileApp.tsx?raw';
import sheet from './ChatSheet.tsx?raw';
import icons from '../Icons.tsx?raw';

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const rule = (sel: string) => [...css.matchAll(new RegExp(`(?:^|\\n|\\})\\s*${esc(sel)}\\s*\\{([^}]*)\\}`, 'g'))].map((m) => m[1]!).join(';');

describe('뽑기·스킨 시트가 열린 동안 채팅창 숨김', () => {
  it('사무실은 뽑기·스킨이 열리면 넓게 쓰겠다고 알리고, 닫히거나 떠나면 거둔다', () => {
    expect(office).toMatch(/onWide\(open === 'gacha' \|\| open === 'skin'\)/);
    expect(office).toMatch(/return \(\) => onWide\(false\)/);
  });
  it('세션 시트는 채팅이 이어져야 해서 그대로(넓게 아님)', () => expect(office).not.toMatch(/onWide\([^)]*'sessions'/));
  it('MobileApp 은 사무실이 넓게면 채팅 시트를 숨긴다(빼지 않고 — 입력 중 글·시트 상태 유지)', () => {
    expect(app).toMatch(/onWide=\{setWide\}/);
    expect(app).toMatch(/hidden=\{view === 'office' && wide\}/);
    expect(sheet).toMatch(/hidden \? ' m-hide' : ''/);
    expect(rule('.m-sheet.m-hide')).toMatch(/visibility:\s*hidden/);
    expect(rule('.m-sheet.m-hide')).toMatch(/pointer-events:\s*none/);
  });
  it('뒤로 나가면 열린 시트를 닫는다 — 다시 들어올 때 채팅창이 숨은 채 시작하지 않게(참모 바꿔 다시 그려질 땐 그대로)', () => {
    expect(office).toMatch(/onClick=\{\(\) => \{ keepOpen = null; onBack\(\); \}\}/);
  });
  it('숨길 때 입력칸에 포커스가 있으면 놓는다(숨은 입력칸에 키보드가 남지 않게)', () => {
    expect(sheet).toMatch(/if \(hidden && sheet\?\.contains\(document\.activeElement\)\) \(document\.activeElement as HTMLElement\)\.blur\(\)/);
  });
  it('넓게일 땐 사무실 아래 여백이 채팅 시트 높이 대신 홈 바만큼', () => {
    expect(office).toMatch(/m-wide/);
    expect(rule('.m-office.m-wide')).toMatch(/padding-bottom:\s*calc\(env\(safe-area-inset-bottom\)/);
  });
});

describe('방 위 칩 — 뽑기·스킨은 아이콘', () => {
  it('직접 그린 도트 아이콘 둘(뽑기 기계·옷걸이)', () => {
    expect(icons).toMatch(/export const IconGacha = /);
    expect(icons).toMatch(/export const IconSkin = /);
    expect(icons).toMatch(/shapeRendering="crispEdges"/);
  });
  it('칩은 아이콘 + 이름표(aria-label·title), 세션 칩은 글자 + 개수 그대로', () => {
    expect(office).toMatch(/\['gacha', '뽑기', <IconGacha \/>\]/);
    expect(office).toMatch(/\['skin', '스킨', <IconSkin \/>\]/);
    expect(office).toMatch(/aria-label=\{name\} title=\{name\}/);
    expect(office).toMatch(/\['sessions', '세션', null\]/);
  });
});

describe('G1 인벤토리 가방', () => {
  it('자리 슬롯은 그림만(이름은 이름표·아래 머리에), 칸은 4줄 격자', () => {
    expect(gacha).toContain('className="m-g1-slots"');
    expect(gacha).toMatch(/aria-label=\{SLOT_NAME\.get\(k\)\} title=\{SLOT_NAME\.get\(k\)\}/);
    expect(rule('.m-g1-grid')).toMatch(/grid-template-columns:\s*repeat\(4, 1fr\)/);
  });
  it('등급 빛 — 희귀 보라 테두리, 전설 금빛 반짝', () => {
    expect(rule('.m-g1-cell.r-희귀')).toMatch(/border-color/);
    expect(rule('.m-g1-cell.r-전설')).toMatch(/animation:\s*m-g-shine/);
  });
  it("바닥 줄 — 되돌리기는 아이콘(이름표), '장착'은 큰 글자 단추", () => {
    expect(gacha).toMatch(/aria-label="되돌리기" title="되돌리기"><IconReplay \/>/);
    expect(gacha).toMatch(/className="m-g-equip"/);
    expect(gacha).toContain("'장착'");
  });
  it('장착이 되면 사무실에 알려 방에 반짝(장착! + 도트 별)', () => {
    expect(gacha).toMatch(/onEquipped\?\.\(\)/);
    expect(office).toMatch(/onEquipped=\{/);
    expect(office).toMatch(/m-equip/);
    expect(rule('.m-office-room.m-equip::before')).toMatch(/content:\s*'장착!'/);
  });
  it('누름 칸 44 — 자리 슬롯·되돌리기·장착', () => {
    expect(rule('.m-g1-slot')).toMatch(/width:\s*48px/);
    expect(rule('.m-g-undo')).toMatch(/width:\s*44px/);
    expect(rule('.m-g-equip')).toMatch(/min-height:\s*4[4-9]px/);
  });
});

describe('시트 틀(P2)', () => {
  it('반 시트는 뽑기 결과 카드 말투(3px 진한 테두리 + 아래 딱딱한 그림자) + 열릴 때 튀어 오름', () => {
    expect(rule('.m-office-sheet')).toMatch(/border:\s*3px solid/);
    expect(rule('.m-office-sheet')).toMatch(/animation:\s*m-g-pop/);
  });
  it('작은 폰은 열리면 참모 줄을 숨기고 시트 머리에 지금 참모 얼굴', () => {
    expect(css).toMatch(/@media \(max-height: \d+px\) \{[^}]*\.m-office-stage\.m-open \.m-talk \{ display: none; \}/);
    expect(office).toContain('m-office-sheet-face');
  });
});
