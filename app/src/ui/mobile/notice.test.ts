// 폰 결과·오류 알림 — 시트·화면 맨 위 줄 대신 가운데 작은 모달 하나(2026-10-05 사용자). 닫기 아이콘·바깥 누름으로 닫히고,
// 정보는 읽을 만큼 뒤 저절로, 오류·할 일이 붙은 안내는 사람이 닫을 때까지
import { describe, expect, it } from 'vitest';
import { noticeCloseMs } from '../../domain/notice';
import notice from './Notice.tsx?raw';
import wake from './OrchWake.tsx?raw';
import picker from './OrchPicker.tsx?raw';
import app from './MobileApp.tsx?raw';
import dash from './OrchDash.tsx?raw';
import routines from './RoutineBoard.tsx?raw';

describe('알림 모달 닫힘 때', () => {
  it('정보는 몇 초 뒤 저절로 — 긴 글은 읽을 만큼 더(4~8초)', () => {
    expect(noticeCloseMs({ text: '이미 켜져 있어요 — 그리로 옮길게요', error: false })).toBe(4000);
    const long = noticeCloseMs({ text: '가'.repeat(200), error: false });
    expect(long).toBe(8000);
  });
  it('오류는 사람이 닫을 때까지', () => {
    expect(noticeCloseMs({ text: '못 켰어요', error: true })).toBeNull();
  });
  it('할 일이 붙은 안내(홈 화면 앱 연결 등)도 사람이 닫을 때까지', () => {
    expect(noticeCloseMs({ text: '홈 화면에 추가해요', error: false, action: true })).toBeNull();
  });
});

describe('알림 모달 모양', () => {
  it('닫기 아이콘(이름 달림)·바깥 누름·화면 전체 위(포털)', () => {
    expect(notice).toMatch(/<IconClose \/>/);
    expect(notice).toMatch(/aria-label="닫기"/);
    expect(notice).toMatch(/m-notice-back/);
    expect(notice).toMatch(/createPortal\(/);
  });
  it('시트·화면 위 결과 줄은 모두 모달로 옮겼다', () => {
    expect(wake).not.toMatch(/className=\{note\.error \? 'm-error' : 'm-wake-note'\}/);
    expect(wake).toMatch(/<Notice /);
    expect(picker).toMatch(/<WakeNotice /);
    expect(app).toMatch(/<WakeNotice /);
    expect(app).not.toMatch(/\{chat\.error && <div className="m-error">/);
    expect(dash).not.toMatch(/m-note-line/);
    expect(routines).not.toMatch(/msg && <div className="m-note-line">/);
    for (const src of [app, dash, routines]) expect(src).toMatch(/<Notice /);
  });
  it('깨우기 결과의 오류는 몇 초 뒤 지우지 않는다(모달이 닫힘을 맡는다)', () => {
    expect(wake).not.toMatch(/WAKE_NOTE_MS/);
  });
});
