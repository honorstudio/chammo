// 참모 줄(마지막 말·물음) 판단은 대화 기록 '살짝 보기'로 — 참모마다 256KB~2MB 를 받던 게 느린 셀룰러 첫 화면 7MB 의 대부분이었다(2026-10-27)
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { makeApi } from './peerApi';

describe('대화 기록 살짝 보기', () => {
  it('peek=1 을 붙여 부른다(이어 읽기 자리 from 도 그대로)', async () => {
    const paths: string[] = [];
    const api = makeApi({ text: async () => '', json: async <T,>(p: string) => { paths.push(p); return {} as T; }, post: async <T,>() => ({}) as T, bytes: async () => new ArrayBuffer(0) });
    await api.peekTranscript('s1');
    await api.peekTranscript('s1', 42);
    expect(paths).toEqual(['/api/transcript?id=s1&peek=1', '/api/transcript?id=s1&peek=1&from=42']);
  });
  it('폰 참모 줄 받기(useOrchAsks)는 살짝 보기만 쓴다', () => {
    const src = readFileSync(new URL('../ui/mobile/useOrchAsks.ts', import.meta.url), 'utf8');
    expect(src).toMatch(/peekTranscript\(/);
    expect(src).not.toMatch(/\breadTranscript\(/);
  });
});
