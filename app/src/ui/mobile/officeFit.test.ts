// "오피스뷰일 때는 스크롤 안 하고 자연스럽게"(2026-10-23 사용자 폰) → 시안 office-fit v1 B "방 크게 · 방 위 칩 + 반 시트"(10-24 사용자 "B가 맞다").
// 방이 칸을 다 쓰고, 세션·뽑기·스킨은 방 위 칩 → 누르면 내용만큼(최대 절반) 반 시트. 열려 있어도 방(지금 참모 고리)·참모 줄이 보이고 눌린다.
import { describe, expect, it } from 'vitest';
import css from './mobile.css?raw';
import src from './PhoneOffice.tsx?raw';
import { fitScale } from '../office/OfficeView';

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const rule = (sel: string) => [...css.matchAll(new RegExp(`(?:^|\\n|\\})\\s*${esc(sel)}\\s*\\{([^}]*)\\}`, 'g'))].map((m) => m[1]!).join(';');
const num = (body: string, prop: string) => Number(body.match(new RegExp(`(?:^|;)\\s*${prop}:\\s*(\\d+)`))?.[1] ?? NaN);

describe('방 배율', () => {
  it("'box' = 칸 폭·높이 둘 다에 맞춰(소수 배율) — 시트가 열려 칸이 낮아지면 방이 준다", () => {
    expect(fitScale('box', 390, 400, 300, 200, 0)).toBeCloseTo(1.3);
    expect(fitScale('box', 390, 160, 300, 200, 0)).toBeCloseTo(0.8);
  });
  it("'width' 는 폭만, 기본(int)은 정수 배율 그대로", () => {
    expect(fitScale('width', 390, 100, 300, 200, 0)).toBeCloseTo(1.3);
    expect(fitScale('int', 1000, 700, 300, 200, 0)).toBe(3);
    expect(fitScale('int', 100, 100, 300, 200, 0)).toBe(1);
  });
  it('빈 칸(0 크기)이어도 0·NaN 이 안 나온다', () => expect(fitScale('box', 0, 0, 300, 200, 0)).toBeGreaterThan(0));
});

describe('사무실 한 화면(B)', () => {
  it('사무실은 페이지 스크롤 없이 세로 flex — 무대(방·칩·참모 줄·반 시트)가 남는 높이를 다 쓴다', () => {
    expect(rule('.m-office')).toMatch(/display:\s*flex/);
    expect(rule('.m-office')).toMatch(/flex-direction:\s*column/);
    expect(rule('.m-office')).toMatch(/overflow:\s*hidden/);
    expect(rule('.m-office-stage')).toMatch(/flex:\s*1/);
    expect(rule('.m-office-stage')).toMatch(/min-height:\s*0/);
  });
  it('닫혀 있으면 칩·방·참모 줄이 한 덩어리로 가운데(칩과 방 사이 빈 띠 없음)', () => {
    expect(rule('.m-office-stage')).toMatch(/justify-content:\s*center/);
    expect(src.indexOf('className="m-office-chips"')).toBeLessThan(src.indexOf("'m-office-room"));
    expect(rule('.m-office-chips')).not.toMatch(/position:\s*absolute/);
  });
  it('방 칸은 방 비율 높이에서 시작해 시트가 열리면 줄고, 방은 칸 폭·높이 둘 다에 맞춰 그린다', () => {
    expect(src).toMatch(/aspectRatio:\s*`\$\{rs\.W\} \/ \$\{rs\.H\}`/);
    expect(src).toMatch(/fit="box"/);
    const r = rule('.m-office-room');
    expect(r).toMatch(/flex:\s*0 1 auto/);
    expect(num(r, 'min-height')).toBeGreaterThanOrEqual(100);
  });
  it('세션·뽑기·스킨은 방 위 칩(누름 칸 44) — 세션 칩엔 개수, 다시 누르면 닫힘', () => {
    expect(src).not.toContain('m-office-tabs');
    expect(src).toMatch(/aria-expanded=\{open === k\}/);
    expect(src).toMatch(/setOpen\(open === k \? null : k\)/);
    expect(num(rule('.m-office-chips button'), 'min-height')).toBeGreaterThanOrEqual(44);
  });
  it('반 시트는 내용만큼, 최대 무대 절반쯤 — 안에서만 굴러간다', () => {
    const s = rule('.m-office-sheet');
    expect(s).toMatch(/flex:\s*none/);
    expect(s).toMatch(/max-height:\s*min\(5\d%, calc\(100% - \d+px\)\)/); // 작은 폰은 칩·방 최소·참모 줄 몫을 남기고
    expect(s).not.toMatch(/(?:^|;)\s*height:/);
    expect(rule('.m-office-panel')).toMatch(/overflow-y:\s*auto/);
    expect(src).toMatch(/className="m-office-sheet" role="dialog"/);
    expect(src).toMatch(/<SheetHead title=\{.+\} onClose=\{\(\) => setOpen\(null\)\} \/>/); // 공용 머리 — 제목 + 닫기 X(IconBtn·aria-label)
  });
  it('시트가 열려 있어도 참모 줄은 시트 위에 남는다(방·참모를 눌러 바꿀 수 있게)', () => {
    expect(src.indexOf('className="m-talk"')).toBeLessThan(src.indexOf('className="m-office-sheet"'));
    expect(rule('.m-talk')).toMatch(/flex:\s*none/);
  });
  it('참모를 바꿔 화면이 다시 그려져도 열린 시트는 그대로(모듈 변수)', () => {
    expect(src).toMatch(/let keepOpen: Sheet \| null/);
    expect(src).toMatch(/keepOpen = /);
  });
  it('방에서 프로젝트 캐릭터를 누르면 세션 시트가 열려 그 줄이 맨 위에 보인다(닫혀 있으면 고리만 생겼다)', () => {
    expect(src).toMatch(/const tap = \(id: string\) => \{[^\n]*setOpen\('sessions'\)/);
  });
  it('참모 줄은 얼굴만, 지금 말하는 참모만 이름(이름은 aria-label·title 에)', () => {
    expect(src).toMatch(/\{d\.id === current && <span>\{d\.label\}<\/span>\}/);
    expect(src).toMatch(/aria-label=\{`\$\{d\.label\}에게 말하기`\} title=\{d\.label\}/);
  });
  it("스킨 '장착'·되돌리기 줄은 시트 바닥에 붙는다(G1 — 뽑기·스킨이 열리면 채팅창이 숨어 작은 폰도 칸이 넉넉)", () => {
    expect(rule('.m-g-foot')).toMatch(/position:\s*sticky/);
    expect(src).toContain('<SkinTab');
  });

});
