import { describe, expect, it } from 'vitest';
import { focusPlan, intentOf, openShortcut, parseAppLog, withFeature } from './appctl';
import { ALL_ON } from './config';
import type { Session } from './session';

describe('intentOf — scripts/app 한 줄 → 앱이 할 일', () => {
  it('음성 켜기·끄기', () => {
    expect(intentOf({ action: 'voice', arg: 'on' })).toEqual({ kind: 'voice', on: true });
    expect(intentOf({ action: 'voice', arg: 'off' })).toEqual({ kind: 'voice', on: false });
  });

  it('기능 켜기·끄기 — "이름 on|off"', () => {
    expect(intentOf({ action: 'feature', arg: 'office off' })).toEqual({ kind: 'feature', name: 'office', on: false });
    expect(intentOf({ action: 'feature', arg: 'tama on' })).toEqual({ kind: 'feature', name: 'tama', on: true });
    // 무인 기계 — 참모가 scripts/app feature autoRevive on 으로 켠다(2026-10-01 아이맥)
    expect(intentOf({ action: 'feature', arg: 'autoRevive on' })).toEqual({ kind: 'feature', name: 'autoRevive', on: true });
    // 화면 조종 모든 프로젝트(2026-10-05)
    expect(intentOf({ action: 'feature', arg: 'computerUse on' })).toEqual({ kind: 'feature', name: 'computerUse', on: true });
  });

  it('열기·닫기·세션으로 가기·다마고치', () => {
    expect(intentOf({ action: 'open', arg: 'settings' })).toEqual({ kind: 'open', what: 'settings' });
    expect(intentOf({ action: 'close', arg: 'reader' })).toEqual({ kind: 'close', what: 'reader' });
    expect(intentOf({ action: 'focus', arg: ' acme-shop ' })).toEqual({ kind: 'focus', target: 'acme-shop' });
    expect(intentOf({ action: 'pet', arg: 'show' })).toEqual({ kind: 'pet', show: true });
    expect(intentOf({ action: 'pet', arg: 'hide' })).toEqual({ kind: 'pet', show: false });
  });

  it('하니터 열고 닫기 — 오케스트레이터가 하네스를 보여 줄 때(2026-10-01 사용자)', () => {
    expect(intentOf({ action: 'open', arg: 'harnitor' })).toEqual({ kind: 'open', what: 'harnitor' });
    expect(intentOf({ action: 'close', arg: 'harnitor' })).toEqual({ kind: 'close', what: 'harnitor' });
    expect(openShortcut('harnitor')).toBeNull();
  });

  it('도구 열고 닫기 — 위 막대 아이콘과 같은 화면(2026-10-05)', () => {
    expect(intentOf({ action: 'open', arg: 'tools' })).toEqual({ kind: 'open', what: 'tools' });
    expect(intentOf({ action: 'close', arg: 'tools' })).toEqual({ kind: 'close', what: 'tools' });
    expect(openShortcut('tools')).toBeNull();
    // 리뷰도 위 막대 아이콘으로 옮겨서 닫기가 생겼다(2026-10-06) — 열기는 예전처럼 ⌘3 과 같은 길(꺼 둔 기능 막기)
    expect(intentOf({ action: 'close', arg: 'review' })).toEqual({ kind: 'close', what: 'review' });
    expect(openShortcut('review')).toEqual({ type: 'goto', to: 'review' });
  });

  it('모르는 동작·인자·깨진 줄은 무시', () => {
    expect(intentOf({ action: 'voice', arg: 'loud' })).toBeNull();
    expect(intentOf({ action: 'feature', arg: 'gold on' })).toBeNull();
    expect(intentOf({ action: 'feature', arg: 'office' })).toBeNull();
    expect(intentOf({ action: 'open', arg: 'kitchen' })).toBeNull();
    expect(intentOf({ action: 'close', arg: 'tour' })).toBeNull();
    expect(intentOf({ action: 'focus', arg: '  ' })).toBeNull();
    expect(intentOf({ action: 'rm', arg: '-rf' })).toBeNull();
    expect(intentOf(null)).toBeNull();
    expect(intentOf('voice on')).toBeNull();
  });
});

describe('parseAppLog — 앱이 넘겨 준 새 줄들', () => {
  it('줄마다 JSON, 깨진 줄은 건너뛴다', () => {
    const log = '{"ts":"1","action":"voice","arg":"on"}\n깨짐\n\n{"ts":"2","action":"open","arg":"tour"}\n';
    expect(parseAppLog(log)).toEqual([{ kind: 'voice', on: true }, { kind: 'open', what: 'tour' }]);
  });
});

describe('openShortcut — 단축키와 같은 길로 가는 것', () => {
  it('설정·둘러보기·사무실·리뷰·전체 보기·참모는 단축키 동작', () => {
    expect(openShortcut('settings')).toEqual({ type: 'settings' });
    expect(openShortcut('tour')).toEqual({ type: 'tour' });
    expect(openShortcut('office')).toEqual({ type: 'goto', to: 'office' });
    expect(openShortcut('review')).toEqual({ type: 'goto', to: 'review' });
    expect(openShortcut('all')).toEqual({ type: 'goto', to: 'all' });
    expect(openShortcut('home')).toEqual({ type: 'goto', to: 'orchestrator' });
  });

  it('토글인 것(리더·작업 패널·결정 대기함·리플레이)은 따로 연다', () => {
    for (const w of ['reader', 'tasks', 'inbox', 'replay'] as const) expect(openShortcut(w)).toBeNull();
  });
});

describe('withFeature — 설정 저장과 같은 모양', () => {
  it('그 기능만 바꾸고 나머지는 그대로', () => {
    const c = { language: 'ko', features: { ...ALL_ON } };
    const next = withFeature(c, 'office', false);
    expect(next.features).toEqual({ ...ALL_ON, office: false });
    expect(next.language).toBe('ko');
    expect(c.features.office).toBe(true); // 원본은 안 바꾼다
  });
});

const s = (id: string, name: string, project: string, sessionId?: string) => ({ id, name, project, sessionId }) as unknown as Session;

describe('focusPlan — 세션 id·이름, 아니면 프로젝트 이름', () => {
  const sessions = [s('a1', 'acme-shop', 'acme-shop', 'uuid-1'), s('b2', 'tax-memo-2', 'tax-memo')];

  it('세션 id·이름·대화 id 로 찾으면 그 세션', () => {
    expect(focusPlan('b2', sessions, [])).toEqual({ session: 'b2' });
    expect(focusPlan('acme-shop', sessions, [])).toEqual({ session: 'a1' });
    expect(focusPlan('uuid-1', sessions, [])).toEqual({ session: 'a1' });
  });

  it('세션이 아니면 프로젝트 이름 — 도는 세션이 없는 프로젝트도', () => {
    expect(focusPlan('tax-memo', sessions, ['tax-memo'])).toEqual({ project: 'tax-memo' });
    expect(focusPlan('idle-proj', sessions, ['idle-proj'])).toEqual({ project: 'idle-proj' });
    expect(focusPlan('없음', sessions, ['idle-proj'])).toBeNull();
  });
});

describe('intentOf — 설정 다시 읽기(참모 scripts/app project 가 config.json 을 고친 뒤)', () => {
  it('config reload 만 받는다', () => {
    expect(intentOf({ action: 'config', arg: 'reload' })).toEqual({ kind: 'reload' });
    expect(intentOf({ action: 'config', arg: 'wipe' })).toBeNull();
  });
});

describe('focus --terminal — 터미널(CLI)은 명시할 때만 (2026-10-02 사용자)', () => {
  // "acme-shop 이랑 todo-api 거 화면에 띄워 줘" 가 문서를 보자는 말이었는데 세션 CLI 가 떴다
  it('--terminal 이 붙으면 터미널로, 없으면 스페이스로', () => {
    expect(intentOf({ action: 'focus', arg: '--terminal acme' })).toEqual({ kind: 'focus', target: 'acme', terminal: true });
    expect(intentOf({ action: 'focus', arg: 'acme' })).toEqual({ kind: 'focus', target: 'acme' });
  });
});

describe("intentOf orch-label — 폰에서 바꾼 참모 별명을 맥 앱 별명에(2026-10-04 사용자 '이름 바꾸기 폰에서도')", () => {
  it('id·nick 이 글이면 label, 아니면 무시', () => {
    expect(intentOf({ action: 'orch-label', arg: { id: 'aaaa0001', nick: '디자인' } })).toEqual({ kind: 'label', id: 'aaaa0001', nick: '디자인' });
    expect(intentOf({ action: 'orch-label', arg: { id: 'aaaa0001', nick: '' } })).toEqual({ kind: 'label', id: 'aaaa0001', nick: '' });
    expect(intentOf({ action: 'orch-label', arg: { id: 1, nick: 'x' } })).toBeNull();
    expect(intentOf({ action: 'orch-label', arg: 'aaaa0001 x' })).toBeNull();
  });
});
