// 참모 바꾸기 시트 — 밀어서 재우기·제거(·꺼진 줄 깨우기)의 확인은 민 그 줄 자리에서(2026-10-23 사용자 폰: 아래 줄을 밀어 재우기를 누르면
// '재울까요?' 칸이 목록 맨 위(기기 줄 아래)에 뜨고 시트가 거기로 올라가서 뜬지도 몰랐다). 그 줄이 확인 줄로 바뀌고, 다른 줄·스크롤은 그대로
import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { RowConfirm } from './RowConfirm';
import picker from './OrchPicker.tsx?raw';
import wake from './OrchWake.tsx?raw';
import rowSrc from './RowConfirm.tsx?raw';
import css from './mobile.css?raw';

const html = (p: Partial<Parameters<typeof RowConfirm>[0]> = {}) =>
  renderToStaticMarkup(createElement(RowConfirm, { label: '재우기 확인', q: '영상담당 재울까요?', ok: '재우기', onOk: () => {}, onCancel: () => {}, ...p }));

describe('줄 자리 확인(RowConfirm)', () => {
  it('물음 + 취소·확인 단추, 화면 읽기에 alertdialog', () => {
    const h = html({ note: '대화는 남아요' });
    expect(h).toMatch(/role="alertdialog" aria-label="재우기 확인"/);
    expect(h).toContain('영상담당 재울까요?');
    expect(h).toContain('대화는 남아요');
    expect(h).toMatch(/>취소<\/button>/);
    expect(h).toMatch(/class="m-send"[^>]*>재우기<\/button>/);
  });
  it('제거는 빨간 확인 단추', () => {
    expect(html({ q: '영상담당 제거할까요?', ok: '제거', danger: true })).toMatch(/class="m-send m-danger"[^>]*>제거<\/button>/);
  });
  it('일하는 중 경고·실패 글은 그 자리에, 누르는 중엔 확인 단추를 막는다', () => {
    const h = html({ warn: '지금 일하는 중이라 하던 게 끊겨요.', err: '못 재웠어요: x', busy: true });
    expect(h).toContain('m-sleep-warn');
    expect(h).toMatch(/class="m-error">못 재웠어요: x</);
    expect(h).toMatch(/disabled=""[^>]*>재우기<\/button>/);
  });
  it('줄보다 커지면 그 줄이 화면 안에 보이게만(가까운 쪽) — 시트를 위로 끌어올리지 않는다', () => {
    expect(rowSrc).toMatch(/scrollIntoView\(\{ block: 'nearest'/);
  });
  it('확인 줄은 다른 참모 줄과 같은 자리 크기(모서리·틈), 왼쪽 띠 없음', () => {
    expect(css).toMatch(/\.m-row-confirm \{[^}]*border-radius: 14px/);
    expect(css).not.toMatch(/\.m-row-confirm[^{]*\{[^}]*border-left/);
  });
});

describe('참모 바꾸기 시트 — 확인이 맨 위가 아니라 그 줄 자리에', () => {
  it('목록 맨 위에 뜨던 재우기·제거 확인 칸이 없다', () => {
    expect(picker).not.toMatch(/\{sleeping && \(/);
    expect(picker).not.toMatch(/\{removing && \(/);
    expect(picker).not.toContain('m-sleep-card');
  });
  it('켜진 줄: 민 그 줄이 재우기·제거 확인 줄로 바뀐다', () => {
    expect(picker).toMatch(/sleeping\?\.id === s\.id/);
    expect(picker).toMatch(/removing\?\.id === s\.id/);
    expect(picker).toMatch(/<RowConfirm [^>]*label=\{tr\('재우기 확인', 'Confirm sleep'\)\}/);
    expect(picker).toMatch(/<RowConfirm [^>]*label=\{tr\('제거 확인', 'Confirm removal'\)\}[^>]*danger/);
  });
  it("재우면 그 줄은 '꺼져 있음'으로 — 15초 받기를 안 기다리고 바로 다시 받는다", () => {
    expect(picker).toMatch(/await stopOrch\(sleeping\.id\);\s*onStopped\(sleeping\.id\);\s*refreshOff\(\);/);
    expect(wake).toMatch(/export const refreshOff = \(\) => window\.dispatchEvent\(new Event\(OFF_REFRESH\)\)/);
  });
  it('꺼진 줄: 제거·깨우기 확인도 그 줄 자리(꺼져 있음 머리 아래 칸이 아니라)', () => {
    expect(wake).not.toContain('m-sleep-card');
    expect(wake).toMatch(/swipe\?\.confirm\?\.\(r\)/);
    expect(wake).toMatch(/ask\?\.key === r\.key/);
    expect(picker).toMatch(/confirm: \(r\) =>/);
  });
});
