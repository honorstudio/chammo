import { afterEach, describe, expect, it } from 'vitest';
import { setLang } from '../i18n';
import { sessionMarks, statusKind, statusLabel, urgentKind } from './statusMark';

afterEach(() => setLang('ko'));

describe('statusKind — 세션 상태 → 사이드바 표시 모양', () => {
  it('작업 중이면 움직이는 표시', () => {
    expect(statusKind('working')).toBe('working');
  });

  it('권한 창·선택지로 막혔으면 손바닥(사람 차례)', () => {
    expect(statusKind('blocked')).toBe('waiting');
  });

  it('아무것도 안 돌면 멈춘 표시', () => {
    expect(statusKind('idle')).toBe('idle');
  });

  it('세션이 없으면 빈 표시', () => {
    expect(statusKind(undefined)).toBe('none');
  });
});

describe('statusLabel — 마우스 올렸을 때·읽어 주기용 이름', () => {
  it('한국어', () => {
    expect(statusLabel('working')).toBe('작업 중');
    expect(statusLabel('waiting')).toBe('답을 기다리는 중');
    expect(statusLabel('idle')).toBe('대기');
    expect(statusLabel('none')).toBe('세션 없음');
  });

  it('영어', () => {
    setLang('en');
    expect(statusLabel('working')).toBe('Working');
    expect(statusLabel('waiting')).toBe('Waiting for you');
    expect(statusLabel('idle')).toBe('Idle');
    expect(statusLabel('none')).toBe('No session');
  });
});

describe('urgentKind — 프로젝트 줄 왼쪽 표시는 가장 급한 세션 것', () => {
  it('손바닥 > 작업 중 > 대기', () => {
    expect(urgentKind(['idle', 'working', 'blocked'])).toBe('waiting');
    expect(urgentKind(['idle', 'working'])).toBe('working');
    expect(urgentKind(['idle'])).toBe('idle');
  });

  it('세션이 없으면 빈 표시', () => {
    expect(urgentKind([])).toBe('none');
  });
});

describe('sessionMarks — 세션 여럿인 프로젝트: 세션마다 표시 하나, 많으면 +N', () => {
  it('넷 이하면 전부, 급한 것부터', () => {
    expect(sessionMarks(['idle', 'working', 'blocked'])).toEqual({ marks: ['waiting', 'working', 'idle'], more: 0 });
    expect(sessionMarks(['idle', 'idle', 'working', 'idle'])).toEqual({ marks: ['working', 'idle', 'idle', 'idle'], more: 0 });
  });

  it('넷 넘으면 셋 + 나머지 수', () => {
    expect(sessionMarks(['idle', 'idle', 'working', 'idle', 'idle'])).toEqual({ marks: ['working', 'idle', 'idle'], more: 2 });
  });

  it('손바닥은 수 뒤로 숨지 않는다 — 맨 끝에 있어도 앞으로', () => {
    const r = sessionMarks(['idle', 'idle', 'idle', 'idle', 'idle', 'blocked']);
    expect(r.marks[0]).toBe('waiting');
    expect(r.more).toBe(3);
  });
});
