import { describe, expect, it } from 'vitest';
import { addNote, editNote, emptyRecord, fmtFrames, fmtShort, fmtTenth, labelClear, parseRecord, phoneSource, removeNote, teamMediaNote, resultText, rulerMarks, spriteCell, xToTime, zoomAround, zoomWindow, type VrNote } from './videoReview';

const n = (t: number, text = 'x', id = `n${t}`): VrNote => ({ id, t, text, at: '2026-11-04T10:00:00Z', from: 'desktop' });

describe('타임코드', () => {
  it('PC 는 프레임까지 — 시·분·초·프레임 고정폭', () => {
    expect(fmtFrames(96, 30)).toBe('00:01:36:00');
    expect(fmtFrames(6.2, 30)).toBe('00:00:06:06');
    expect(fmtFrames(171.5, 30)).toBe('00:02:51:15');
    expect(fmtFrames(3725.4, 25)).toBe('01:02:05:10');
  });
  it('프레임은 그 초를 넘어 올림하지 않는다(59.99초가 60프레임째로 안 보인다)', () => {
    expect(fmtFrames(59.99, 30)).toBe('00:00:59:29');
  });
  it('29.97 도 30 칸으로 센다(드롭 프레임 표시 안 함)', () => {
    expect(fmtFrames(1.5, 29.97)).toBe('00:00:01:15');
  });
  it('폰은 0.1초 — 자릿수 고정, 올림이 분으로 넘어간다', () => {
    expect(fmtTenth(96)).toBe('01:36.0');
    expect(fmtTenth(6.2)).toBe('00:06.2');
    expect(fmtTenth(59.96)).toBe('01:00.0');
    expect(fmtTenth(3725.4)).toBe('1:02:05.4');
  });
  it('이상한 값은 0 으로', () => {
    expect(fmtTenth(Number.NaN)).toBe('00:00.0');
    expect(fmtTenth(-3)).toBe('00:00.0');
    expect(fmtFrames(Number.POSITIVE_INFINITY, 30)).toBe('00:00:00:00');
  });
  it('fps 를 모르면 프레임을 지어내지 않고 0.1초로', () => {
    expect(fmtFrames(96, undefined)).toBe('01:36.0');
    expect(fmtFrames(96, 0)).toBe('01:36.0');
  });
  it('눈금 글자는 짧게', () => {
    expect(fmtShort(0)).toBe('0:00');
    expect(fmtShort(90)).toBe('1:30');
    expect(fmtShort(3725)).toBe('1:02:05');
  });
});

describe('말 다루기', () => {
  it('추가하면 시각순 + 글 앞뒤 공백 정리 + 초 소수 셋째 자리', () => {
    const a = addNote([n(50)], 12.34567, '  첫 컷  ', { id: 'a', at: 'T', from: 'phone' });
    expect(a.map((x) => x.t)).toEqual([12.346, 50]);
    expect(a[0]).toMatchObject({ id: 'a', text: '첫 컷', at: 'T', from: 'phone' });
  });
  it('빈 글은 안 들어간다', () => {
    const base = [n(1)];
    expect(addNote(base, 3, '   ', { id: 'a', at: 'T', from: 'phone' })).toBe(base);
  });
  it('같은 시각이면 먼저 남긴 말이 앞', () => {
    const a = addNote([n(5, '앞', 'x')], 5, '뒤', { id: 'y', at: 'T', from: 'phone' });
    expect(a.map((x) => x.text)).toEqual(['앞', '뒤']);
  });
  it('고치기 — 시각은 그대로, 비우면 안 바꾼다', () => {
    const base = [n(1, '옛', 'a')];
    expect(editNote(base, 'a', ' 새 ')[0]).toMatchObject({ t: 1, text: '새' });
    expect(editNote(base, 'a', '  ')).toBe(base);
  });
  it('지우기', () => {
    expect(removeNote([n(1, 'x', 'a'), n(2, 'y', 'b')], 'a').map((x) => x.id)).toEqual(['b']);
  });
});

describe('기록 파일', () => {
  it('빈 기록은 판 번호·경로를 갖는다', () => {
    expect(emptyRecord('/a/v8.mp4')).toEqual({ v: 1, source: { path: '/a/v8.mp4' }, notes: [] });
  });
  it('읽기 — 깨진 글·모르는 모양·이상한 말은 버린다', () => {
    expect(parseRecord('', '/a.mp4').notes).toEqual([]);
    expect(parseRecord('{깨짐', '/a.mp4').notes).toEqual([]);
    expect(parseRecord('{"v":1,"notes":"x"}', '/a.mp4').notes).toEqual([]);
    const r = parseRecord(JSON.stringify({ v: 1, source: { path: '/a.mp4', fps: 30 }, notes: [{ id: 'a', t: 3, text: 'ok' }, { id: 'b', t: 'x', text: 'no' }, { id: 'c', t: 1, text: '' }, null] }), '/a.mp4');
    expect(r.notes.map((x) => x.id)).toEqual(['a']);
    expect(r.source.fps).toBe(30);
  });
  it('다른 영상의 기록이면 말을 안 가져온다(이름이 겹친 다른 폴더)', () => {
    expect(parseRecord(JSON.stringify({ v: 1, source: { path: '/b.mp4' }, notes: [{ id: 'a', t: 3, text: 'ok' }] }), '/a.mp4').notes).toEqual([]);
  });
  it('필름 마커·상태 칸은 지키고 모르는 값은 버린다 — 앱이 다시 저장해도 필름 연결이 안 끊긴다', () => {
    const r = parseRecord(JSON.stringify({ v: 1, source: { path: '/a.mp4' }, notes: [
      { id: 'a', t: 3, text: 'ok', film: { marker: 7 }, state: 'cut', moved: '/b.mp4' },
      { id: 'b', t: 4, text: 'x', film: { marker: 'no' }, state: 'weird' },
    ] }), '/a.mp4');
    expect(r.notes[0]).toMatchObject({ film: { marker: 7 }, state: 'cut', moved: '/b.mp4' });
    expect(r.notes[1]!.film).toBeUndefined();
    expect(r.notes[1]!.state).toBeUndefined();
  });
  it('기록 머리의 모르는 칸(filmSeen 등)도 지킨다', () => {
    const r = parseRecord(JSON.stringify({ v: 1, source: { path: '/a.mp4', filmSeen: [1, 2] }, notes: [] }), '/a.mp4');
    expect(r.source).toMatchObject({ path: '/a.mp4', filmSeen: [1, 2] });
  });
  it('고쳐도 필름 칸이 남는다', () => {
    const base: VrNote[] = [{ ...n(1, '옛', 'a'), film: { marker: 3 } }];
    expect(editNote(base, 'a', '새')[0]!.film).toEqual({ marker: 3 });
  });
  it('말 순서가 어긋난 파일도 시각순으로 읽는다', () => {
    const r = parseRecord(JSON.stringify({ v: 1, source: { path: '/a.mp4' }, notes: [{ id: 'b', t: 9, text: 'b' }, { id: 'a', t: 3, text: 'a' }] }), '/a.mp4');
    expect(r.notes.map((x) => x.id)).toEqual(['a', 'b']);
  });
});

describe('참모가 받는 글', () => {
  it('시각순 목록·길이·개수·기록 파일', () => {
    const t = resultText({ path: '/m/v8.mp4', duration: 180, notes: [n(6.2, '첫 컷'), n(96, '이 컷')], recordPath: '/d/curation/m-v8.state.json' });
    expect(t).toContain('v8.mp4');
    expect(t).toContain('3:00');
    expect(t).toContain('2');
    expect(t).toContain('/d/curation/m-v8.state.json');
    expect(t).toContain('- 00:06.2 첫 컷\n- 01:36.0 이 컷');
  });
  it('여러 줄 말은 한 항목으로 — 줄을 꺾어 다른 항목처럼 보이지 않게', () => {
    expect(resultText({ path: '/v.mp4', notes: [n(1, '가\n- 01:00.0 가짜 항목')] })).toContain('- 00:01.0 가 - 01:00.0 가짜 항목');
  });
});

describe('눈금', () => {
  it('왼쪽 끝이 0, 오른쪽 끝이 끝 — 시간과 폭이 그대로 맞물린다', () => {
    expect(xToTime(0, 900, 0, 180)).toBe(0);
    expect(xToTime(900, 900, 0, 180)).toBe(180);
    expect(xToTime(450, 900, 0, 180)).toBe(90);
    expect(xToTime(-20, 900, 0, 180)).toBe(0);
    expect(xToTime(9999, 900, 0, 180)).toBe(180);
  });
  it('PC 폭이면 3분 영상 큰 눈금이 30초마다, 글자가 안 겹칠 만큼 벌어진다', () => {
    const m = rulerMarks(0, 180, 984, 92);
    const big = m.filter((x) => x.big);
    expect(big.slice(0, 3).map((x) => x.t)).toEqual([0, 30, 60]);
    expect(big[1]!.x - big[0]!.x).toBeGreaterThanOrEqual(92);
  });
  it('폰 폭이면 큰 눈금이 성겨진다', () => {
    const big = rulerMarks(0, 180, 390, 40).filter((x) => x.big);
    expect(big[1]!.x - big[0]!.x).toBeGreaterThanOrEqual(40);
    expect(big.length).toBeLessThan(10);
  });
  it('1시간 영상도 눈금이 폭을 넘치지 않는다', () => {
    const m = rulerMarks(0, 3600, 390, 40);
    expect(m.length).toBeLessThan(200);
    expect(m.every((x) => x.x >= 0 && x.x <= 390)).toBe(true);
  });
  it('길이가 0·이상한 값이면 눈금 없음', () => {
    expect(rulerMarks(0, 0, 900, 92)).toEqual([]);
    expect(rulerMarks(0, Number.NaN, 900, 92)).toEqual([]);
  });
  it('눈금 글자가 재생 위치 선과 겹치면 숨긴다(11-04 T2 1:30 글자)', () => {
    expect(labelClear(100, 92, 130)).toBe(false); // 글자 100~192 안에 선
    expect(labelClear(100, 92, 95)).toBe(true); // 글자 앞
    expect(labelClear(100, 92, 200)).toBe(true); // 글자 뒤
  });
});

describe('길게 눌러 펴기', () => {
  it('누른 자리 앞뒤 7.5초', () => {
    expect(zoomWindow(96, 180)).toEqual({ lo: 88.5, hi: 103.5 });
  });
  it('처음·끝에선 영상 안으로 밀어 15초 폭을 지킨다', () => {
    expect(zoomWindow(2, 180)).toEqual({ lo: 0, hi: 15 });
    expect(zoomWindow(178, 180)).toEqual({ lo: 165, hi: 180 });
  });
  it('영상이 15초보다 짧으면 전체', () => {
    expect(zoomWindow(4, 10)).toEqual({ lo: 0, hi: 10 });
  });
});

describe('손가락 자리 그대로 펴기', () => {
  it('누른 시각이 펴진 뒤에도 손가락 밑에 있다', () => {
    const w = zoomAround(96, 195, 390, 180);
    expect(xToTime(195, 390, w.lo, w.hi)).toBeCloseTo(96);
    const left = zoomAround(96, 39, 390, 180);
    expect(xToTime(39, 390, left.lo, left.hi)).toBeCloseTo(96);
  });
  it('처음·끝에선 밀린다', () => {
    expect(zoomAround(1, 300, 390, 180).lo).toBe(0);
    expect(zoomAround(179, 10, 390, 180).hi).toBe(180);
  });
  it('짧은 영상은 전체', () => {
    expect(zoomAround(4, 10, 390, 10)).toEqual({ lo: 0, hi: 10 });
  });
});

describe('그림 묶음', () => {
  const s = { interval: 2, cols: 10, rows: 10, count: 90, cw: 160, ch: 90 };
  it('시각 → 판 번호·칸 위치', () => {
    expect(spriteCell(0, s)).toEqual({ sheet: 0, col: 0, row: 0 });
    expect(spriteCell(25, s)).toEqual({ sheet: 0, col: 2, row: 1 });
  });
  it('100칸을 넘으면 다음 판', () => {
    expect(spriteCell(204, { ...s, count: 300 })).toEqual({ sheet: 1, col: 2, row: 0 });
  });
  it('끝을 넘어도 마지막 칸', () => {
    expect(spriteCell(9999, s)).toEqual({ sheet: 0, col: 9, row: 8 });
  });
  it('음수·이상한 값은 첫 칸', () => {
    expect(spriteCell(-1, s)).toEqual({ sheet: 0, col: 0, row: 0 });
    expect(spriteCell(Number.NaN, s)).toEqual({ sheet: 0, col: 0, row: 0 });
  });
});

describe('폰이 틀 영상', () => {
  const t = { url: '/api/media?t=a', size: 150_000_000 };
  it('저용량이 있으면 그것', () => {
    expect(phoneSource({ ...t, prep: { state: 'ready', low: 17_000_000, needsLow: true } })).toEqual({ kind: 'low', url: '/api/media?t=a&low=1', bytes: 17_000_000 });
  });
  it('큰 영상을 만드는 중이면 기다린다 — 원본을 터널로 안 보낸다', () => {
    expect(phoneSource({ ...t, prep: { state: 'making', needsLow: true } })).toEqual({ kind: 'wait' });
    expect(phoneSource({ ...t, prep: { state: 'idle', needsLow: true } })).toEqual({ kind: 'wait' });
  });
  it('작은 영상은 그림 묶음을 만드는 중이어도 원본을 바로', () => {
    expect(phoneSource({ url: '/m', size: 5_000_000, prep: { state: 'making', needsLow: false } })).toEqual({ kind: 'orig', url: '/m', bytes: 5_000_000 });
  });
  it('도우미 없음·실패·옛 데스크톱은 원본', () => {
    expect(phoneSource({ ...t, prep: { state: 'none', needsLow: true } }).kind).toBe('orig');
    expect(phoneSource({ ...t, prep: { state: 'failed', needsLow: true } }).kind).toBe('orig');
    expect(phoneSource({ ...t }).kind).toBe('orig');
  });
});

// 11-04 폰 팀 보관함 영상 — 맥이 받는 동안 한 줄, 실패면 까닭 한 줄
describe('팀 영상 받는 중 줄', () => {
  it('전체 크기를 알면 퍼센트, 모르면(목록 받는 중·데스크톱이 먼저 받는 중) 여는 중', () => {
    expect(teamMediaNote({ state: 'going', done: 46, total: 100 })).toEqual({ k: 'fetch', pct: 46, total: 100 });
    expect(teamMediaNote({ state: 'going', done: 920 * 1024 ** 2, total: 920 * 1024 ** 2 })).toEqual({ k: 'fetch', pct: 100, total: 920 * 1024 ** 2 });
    expect(teamMediaNote({ state: 'going', done: 1, total: 3 }).k === 'fetch' && teamMediaNote({ state: 'going', done: 1, total: 3 })).toMatchObject({ pct: 33 });
    expect(teamMediaNote({ state: 'going', done: 0, total: 0 })).toEqual({ k: 'open' });
  });
  it('실패 까닭은 넷(망·자리·지워짐·그 밖) — 멈춤·모르는 말은 그 밖', () => {
    for (const w of ['net', 'disk', 'gone'] as const) expect(teamMediaNote({ state: 'failed', why: w })).toEqual({ k: 'fail', why: w });
    for (const w of ['stopped', 'other', '??']) expect(teamMediaNote({ state: 'failed', why: w })).toEqual({ k: 'fail', why: 'other' });
  });
});
