import { afterEach, describe, expect, it } from 'vitest';
import { setLang } from '../i18n';
import { ago, dockLine, noteOf, pushTick } from './dock';

describe('dockLine — 사무실 아래 현황판 한 줄', () => {
  it('작업 중이면 행동 이름 + 대상', () => {
    expect(dockLine('working', 'type', 'Edit ambassador.ts')).toEqual({ verb: '고치는 중', text: 'Edit ambassador.ts' });
    expect(dockLine('working', 'run', 'Bash npm test')).toEqual({ verb: '실행 중', text: 'Bash npm test' });
  });
  it('작업 중인데 도구가 아직 없으면 생각 중', () => {
    expect(dockLine('working', 'think', undefined)).toEqual({ verb: '생각 중', text: '' });
  });
  it('작업 중이 아니면 상태만', () => {
    expect(dockLine('asks', undefined, undefined).verb).toBe('물어봄');
    expect(dockLine('done', undefined, undefined).verb).toBe('끝남');
    expect(dockLine('wait', undefined, undefined).verb).toBe('대기');
    expect(dockLine('sleep', undefined, undefined).verb).toBe('잠듦');
  });
});

describe('pushTick — 하는 일이 바뀔 때마다 위에 쌓고 3줄만', () => {
  it('새 일은 맨 위, 같은 일이면 그대로', () => {
    let t = pushTick([], 'Read a.ts', 1000);
    t = pushTick(t, 'Read a.ts', 2000);
    expect(t).toEqual([{ text: 'Read a.ts', at: 1000 }]);
    t = pushTick(t, 'Edit a.ts', 3000);
    expect(t.map((x) => x.text)).toEqual(['Edit a.ts', 'Read a.ts']);
  });
  it('3줄 넘으면 오래된 것부터 버린다', () => {
    const t = ['a', 'b', 'c', 'd'].reduce((acc, s, i) => pushTick(acc, s, i), [] as ReturnType<typeof pushTick>);
    expect(t.map((x) => x.text)).toEqual(['d', 'c', 'b']);
  });
  it('빈 일은 안 쌓는다', () => { expect(pushTick([], '', 1)).toEqual([]); });
});

describe('ago — 얼마 전', () => {
  it('10초 전까진 방금, 그다음 초·분·시간', () => {
    expect(ago(0, 9_000)).toBe('방금');
    expect(ago(0, 42_000)).toBe('42초');
    expect(ago(0, 3 * 60_000 + 5_000)).toBe('3분');
    expect(ago(0, 2 * 3600_000)).toBe('2시간');
  });
});

describe('noteOf — 일 안 할 때 카드에 보일 마지막 답', () => {
  it('마크다운 기호·줄바꿈을 걷어 한 줄로', () => {
    expect(noteOf('**계정 삭제** PR #394 CI 초록.\n\n- `retained_records` 분리')).toBe('계정 삭제 PR #394 CI 초록. - retained_records 분리');
  });
  it('없으면 빈 줄', () => { expect(noteOf(undefined)).toBe(''); });
});

describe('영어 현황판', () => {
  afterEach(() => setLang('ko'));
  it('행동·상태·얼마 전이 영어로', () => {
    setLang('en');
    expect(dockLine('working', 'type', 'Edit a.ts').verb).toBe('Editing');
    expect(dockLine('asks', undefined, undefined).verb).toBe('Asking');
    expect(ago(0, 9_000)).toBe('now');
    expect(ago(0, 3 * 60_000)).toBe('3m');
  });
});
