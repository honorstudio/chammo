import { describe, expect, it, vi } from 'vitest';
import { bufferedStore, draftStore } from './chatDraft';

const fake = () => {
  const m = new Map<string, string>();
  return { m, s: { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) } };
};

describe('draftStore — 채팅 입력칸에 쓰던 글을 세션마다(참모 1→2 옮기다 긴 글이 날아갔다, 2026-09-30 사용자)', () => {
  it('세션마다 따로 남고 다시 오면 그대로', () => {
    const { s } = fake();
    const d = draftStore(s);
    d.save('b1', { text: '긴 지시 @chat1', refs: [{ label: '@chat1', who: '답', text: '인용' }] });
    d.save('b2', { text: '다른 말', refs: [] });
    expect(d.load('b1')).toEqual({ text: '긴 지시 @chat1', refs: [{ label: '@chat1', who: '답', text: '인용' }] });
    expect(d.load('b2').text).toBe('다른 말');
  });
  it('앱을 다시 켜도(저장소에서) 살아난다', () => {
    const { s } = fake();
    draftStore(s).save('b1', { text: '남은 글', refs: [] });
    expect(draftStore(s).load('b1').text).toBe('남은 글');
  });
  it('비우면 저장소에서도 지운다, 없는 세션·깨진 값은 빈 입력칸', () => {
    const { m, s } = fake();
    const d = draftStore(s);
    d.save('b1', { text: '보낼 글', refs: [] });
    d.save('b1', { text: '', refs: [] });
    expect(m.size).toBe(0);
    m.set('chatDraft:x', '{깨짐');
    expect(draftStore(s).load('x')).toEqual({ text: '', refs: [] });
    expect(d.load(undefined)).toEqual({ text: '', refs: [] });
  });
  it('저장소가 막혀도(개인 창 등) 이번 실행 동안은 기억한다', () => {
    const boom = { getItem: () => { throw new Error('x'); }, setItem: () => { throw new Error('x'); }, removeItem: () => { throw new Error('x'); } };
    const d = draftStore(boom);
    d.save('b1', { text: '글', refs: [] });
    expect(d.load('b1').text).toBe('글');
  });
});

describe('bufferedStore — 데이터 폴더 파일(drafts.json, 600)로 남기기(10-28 "채팅하다가 나가면 채팅 지워짐")', () => {
  const io = (file: Record<string, string> = {}, fail = false) => {
    const writes: Record<string, string | null>[] = [];
    return { writes, file, read: async () => { if (fail) throw new Error('no tauri'); return { ...file }; }, write: async (c: Record<string, string | null>) => { if (fail) throw new Error('no tauri'); writes.push(c); Object.assign(file, c); } };
  };
  it('켤 때 파일에서 읽어 오고, 쓰기는 모아서 바뀐 대화만', async () => {
    vi.useFakeTimers();
    const f = io({ 'teamDraft:r1': '{"text":"쓰던 글","refs":[]}' });
    const s = bufferedStore(f);
    await s.load();
    expect(draftStore(s, 'teamDraft:').load('r1').text).toBe('쓰던 글');
    const d = draftStore(s, 'teamDraft:');
    d.save('r2', { text: '가', refs: [] });
    d.save('r2', { text: '가나', refs: [] });
    d.save('r1', { text: '', refs: [] });
    expect(f.writes).toEqual([]);
    await vi.advanceTimersByTimeAsync(500);
    expect(f.writes).toEqual([{ 'teamDraft:r2': '{"text":"가나","refs":[]}', 'teamDraft:r1': null }]);
    vi.useRealTimers();
  });
  it('localStorage 에 있던 옛 참모 채팅 글은 파일로 옮기고 지운다(파일에 써진 뒤에만)', async () => {
    const old = new Map([['chatDraft:s1', '{"text":"옛 글","refs":[]}'], ['lang', 'ko']]);
    const legacy = { keys: () => [...old.keys()], get: (k: string) => old.get(k) ?? null, remove: (k: string) => void old.delete(k) };
    const f = io();
    const s = bufferedStore(f, legacy, 'chatDraft:');
    await s.load();
    expect(f.file['chatDraft:s1']).toBe('{"text":"옛 글","refs":[]}');
    expect([...old.keys()]).toEqual(['lang']);
    const failing = io({}, true);
    const old2 = new Map([['chatDraft:s1', 'x']]);
    await bufferedStore(failing, { keys: () => [...old2.keys()], get: (k) => old2.get(k) ?? null, remove: (k) => void old2.delete(k) }, 'chatDraft:').load();
    expect(old2.size).toBe(1);
  });
  it('Tauri 가 없으면(폰·브라우저) 이번 실행 동안 메모리로', async () => {
    const s = bufferedStore(io({}, true));
    await s.load();
    s.setItem('teamDraft:r1', 'x');
    await s.flush();
    expect(s.getItem('teamDraft:r1')).toBe('x');
  });
  it('읽기가 늦게 와도 그 사이 쓴 글을 옛 값으로 덮지 않는다', async () => {
    const f = io({ 'teamDraft:r1': '{"text":"옛","refs":[]}' });
    const s = bufferedStore(f);
    const p = s.load();
    s.setItem('teamDraft:r1', '{"text":"새","refs":[]}');
    await p;
    expect(s.getItem('teamDraft:r1')).toBe('{"text":"새","refs":[]}');
  });
  // 공개 이슈 #24 '채팅하다 나가면 대화가 지워진다': 메인 창과 메신저 창은 켤 때 한 번씩만 파일을 읽어 각자 메모리에 둔다 —
  // 메신저 창에서 고친 글을 메인 창은 모르고 옛 글(빈 글)을 보여 준 뒤 그대로 다시 써서 파일의 새 글을 지웠다
  it('다른 창이 고친 글 — 창으로 돌아와 다시 읽으면(refresh) 새 글, 옛 글로 덮지 않는다', async () => {
    vi.useFakeTimers();
    const f = io({});
    const mainFile = bufferedStore(f);
    const msgFile = bufferedStore(f);
    await mainFile.load();
    const main = draftStore(mainFile, 'teamDraft:');
    main.save('r1', { text: '옛 글', refs: [] });
    await vi.advanceTimersByTimeAsync(500);
    await msgFile.load();
    const msg = draftStore(msgFile, 'teamDraft:');
    expect(msg.load('r1').text).toBe('옛 글');
    msg.save('r1', { text: '메신저 창에서 이어 쓴 글', refs: [] });
    msg.save('r2', { text: '새 대화 글', refs: [] });
    await vi.advanceTimersByTimeAsync(500);
    await mainFile.refresh();
    expect(main.load('r1').text).toBe('메신저 창에서 이어 쓴 글');
    expect(main.load('r2').text).toBe('새 대화 글');
    msg.save('r2', { text: '', refs: [] });
    await vi.advanceTimersByTimeAsync(500);
    await mainFile.refresh();
    expect(main.load('r2').text, '다른 창이 지운 글은 지운 대로').toBe('');
    vi.useRealTimers();
  });
  it('다시 읽는 사이 이 창에서 쓴(아직 안 써진) 글은 그대로', async () => {
    const f = io({ 'teamDraft:r1': '{"text":"파일","refs":[]}' });
    const s = bufferedStore(f, undefined, '', 10_000);
    await s.load();
    s.setItem('teamDraft:r1', '{"text":"이 창","refs":[]}');
    await s.refresh();
    expect(s.getItem('teamDraft:r1')).toBe('{"text":"이 창","refs":[]}');
  });
});
