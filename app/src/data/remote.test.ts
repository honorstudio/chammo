import { beforeEach, describe, expect, it, vi } from 'vitest';

const invoke = vi.fn();
// 거절은 vi.fn 밖에서 — vi.fn 이 돌려준 거절 promise 는 처리해도 vitest 가 놓친 거절로 센다(값을 지켜보느라 따로 이어 붙인다)
let reject: unknown = null;
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...a: unknown[]) => (reject !== null ? Promise.reject(reject) : invoke(...a)) }));

import { NeedsPairError, remoteApi } from './remote';

beforeEach(() => {
  invoke.mockReset();
  reject = null;
});

const out = (status: number, text: string | null, b64: string | null = null) => ({ status, text, b64 });

describe('다른 기기 참모 — 폰과 같은 이름·모양을 remote_call 로', () => {
  it('글 받기는 GET 을 그 기기로 대신 보낸다', async () => {
    invoke.mockResolvedValue(out(200, '[{"id":"a"}]'));
    expect(await remoteApi('nBOX').listSessionsRaw()).toBe('[{"id":"a"}]');
    expect(invoke).toHaveBeenCalledWith('remote_call', { id: 'nBOX', method: 'GET', path: '/api/sessions', body: null });
  });
  it('env 는 JSON 으로 읽고 경로를 / 모양으로(윈도우 기기)', async () => {
    invoke.mockResolvedValue(out(200, JSON.stringify({ assistantName: '참모', language: 'ko', devRoot: 'C:\\Users\\Me\\dev', extraProjects: [], hqDir: 'C:\\Users\\Me/.chammo/hq' })));
    const e = await remoteApi('nBOX').getEnv();
    expect(e.hqDir).toBe('C:/Users/Me/.chammo/hq');
    expect(e.devRoot).toBe('C:/Users/Me/dev');
  });
  it('대화 기록은 세션 번호를 인코딩해서', async () => {
    invoke.mockResolvedValue(out(200, '{"text":"","next":0,"reset":true}'));
    await remoteApi('nBOX').readTranscript('f00d 1', 3);
    expect(invoke.mock.calls[0]![1].path).toBe('/api/transcript?id=f00d%201&from=3');
  });
  it('보내기는 POST JSON 몸통', async () => {
    invoke.mockResolvedValue(out(200, '{"ok":true}'));
    await remoteApi('nBOX').sendTextToSession('aaaa0001', '안녕', 'c1');
    expect(invoke).toHaveBeenCalledWith('remote_call', { id: 'nBOX', method: 'POST', path: '/api/send', body: JSON.stringify({ id: 'aaaa0001', text: '안녕', cid: 'c1' }) });
  });
  it('서버 오류 글은 폰과 같이 — 멈춤 409 not working 은 idle', async () => {
    invoke.mockResolvedValue(out(409, 'not working'));
    expect(await remoteApi('nBOX').interruptSession('aaaa0001')).toBe('idle');
    invoke.mockResolvedValue(out(502, 'boom'));
    await expect(remoteApi('nBOX').listSessionsRaw()).rejects.toThrow('boom');
  });
  it('열쇠가 끊겼으면(pair) 짝짓기 필요 오류', async () => {
    reject = 'pair';
    const got = await remoteApi('nBOX').listSessionsRaw().then(() => null, (e: unknown) => e);
    expect(got).toBeInstanceOf(NeedsPairError);
  });
  it('브라우저 화면은 base64 → 바이트', async () => {
    invoke.mockResolvedValue(out(200, null, 'AAEC/w=='));
    const b = new Uint8Array(await remoteApi('nBOX').browserFrame('p1', 0));
    expect([...b]).toEqual([0, 1, 2, 255]);
    expect(invoke.mock.calls[0]![1].path).toBe('/api/browser-frame?profile=p1&since=0');
  });
});
