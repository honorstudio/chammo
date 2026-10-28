// 2026-10-29 간판 제작도 .ai(PDF 호환 없는 PostScript)를 show 하면 '미리보기 만드는 중'에서 안 넘어갔다 — qlmanage 가 영영 안 돌아오고
// 답을 기다리는 쪽에 한도가 없었다. 실패·시간 초과면 '미리보기를 못 만들었어 — 참모 벡터로 열기' 한 줄로 끝난다
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { inTime, PREVIEW_WAIT_MS, PAGE_DOC_WAIT_MS } from '../../domain/reader';
import { PreviewFail } from '../craft/openInCraft';
import reader from './Reader.tsx?raw';
import preview from '../space/Preview.tsx?raw';
import rust from '../../../src-tauri/src/reader.rs?raw';

afterEach(() => { vi.useRealTimers(); });

describe('inTime — 답이 안 오면 한도에서 실패', () => {
  it('제때 온 답은 그대로', async () => {
    await expect(inTime(Promise.resolve('/ql/a.png'), 1000)).resolves.toBe('/ql/a.png');
  });
  it('실패도 그대로 넘긴다', async () => {
    await expect(inTime(Promise.reject(new Error('없는 파일')), 1000)).rejects.toThrow('없는 파일');
  });
  it('영영 안 오면 한도에서 실패', async () => {
    vi.useFakeTimers();
    const p = inTime(new Promise<string>(() => {}), 5000);
    const seen = vi.fn();
    p.catch(seen);
    await vi.advanceTimersByTimeAsync(4999);
    expect(seen).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(seen).toHaveBeenCalledTimes(1);
  });
  it('웹 한도는 Rust 길 한도(엔진 20초 + QuickLook 20초, page_doc 60초)보다 길다 — Rust 가 먼저 까닭을 준다', () => {
    const secs = (name: string) => Number(rust.match(new RegExp(`const ${name}: std::time::Duration = std::time::Duration::from_secs\\((\\d+)\\)`))?.[1]);
    expect(secs('THUMB_LIMIT')).toBe(20);
    expect(PREVIEW_WAIT_MS).toBeGreaterThan(2 * secs('THUMB_LIMIT') * 1000);
    expect(PAGE_DOC_WAIT_MS).toBeGreaterThan(secs('PAGE_DOC_LIMIT') * 1000);
  });
});

describe('미리보기를 못 만들었을 때 한 줄', () => {
  const html = (path: string, why?: string) => renderToStaticMarkup(createElement(PreviewFail, { path, why }));
  it('참모 앱이 여는 형식이면 — 참모 벡터로 열기', () => {
    const h = html('/u/brand/입구간판_제작도.ai');
    expect(h).toContain('미리보기를 못 만들었어');
    expect(h).toMatch(/class="co-chip"[^>]*>참모 벡터로 열기<\/button>/);
  });
  it('참모 앱이 없는 형식이면 글만', () => {
    const h = html('/u/발표.key');
    expect(h).toContain('미리보기를 못 만들었어');
    expect(h).not.toContain('co-chip');
  });
  it('오류 원문은 화면 글이 아니라 이름표로', () => {
    const h = html('/u/a.ai', '미리보기를 못 만들었어 (command timed out)');
    expect(h).toContain('title="미리보기를 못 만들었어 (command timed out)"');
    expect(h.replace(/title="[^"]*"/g, '')).not.toContain('timed out');
  });
});

describe('기다리는 쪽 — 한도와 실패 줄', () => {
  it('그림 한 장(ql_thumb)은 한도 안에서 기다리고, 실패면 PreviewFail', () => {
    expect(reader).toMatch(/inTime\(invoke<string>\('ql_thumb', \{ path \}\), PREVIEW_WAIT_MS\)/);
    expect(reader).toMatch(/<PreviewFail path=\{path\}/);
    expect(reader).not.toMatch(/err \|\| tr\('미리보기 만드는 중'/); // 오류 원문(qlmanage 출력)을 화면 글로 쓰던 자리
  });
  it('슬라이드·페이지(page_doc)도 한도 — 넘기면 그림 한 장 길로', () => {
    expect(preview).toMatch(/inTime\(invoke<string>\('page_doc', \{ path: f\.path \}\), PAGE_DOC_WAIT_MS\)/);
  });
  it('늦게 온 앞 파일 답은 버린다', () => {
    const extra = reader.slice(reader.indexOf('export function ExtraDoc'), reader.indexOf('function Doc('));
    expect(extra).toMatch(/return \(\) => \{ live = false; \}/);
  });
});
