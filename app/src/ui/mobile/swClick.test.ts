// 알림 누름(notificationclick) — 두 서비스 워커(테일넷 public/sw.js · 중계 입구 public-phone/sw.js)를 가짜 self 위에서 그대로 돌린다.
// 2026-10-23 사용자: 결정 알림을 눌러도 앱만 열리고 보던 시트(참모 바꾸기)에 그대로였다 — 열린 창이 받으면(받았다는 답) 그대로, 못 받으면 그 주소로 다시 열기, 창이 없으면 새로
import { afterEach, describe, expect, it, vi } from 'vitest';
import tailRaw from '../../../public/sw.js?raw';
import relayRaw from '../../../public-phone/sw.js?raw';

type Handler = (e: unknown) => void;
type Win = { url: string; focused: boolean; postMessage: ReturnType<typeof vi.fn>; focus: ReturnType<typeof vi.fn>; navigate: ReturnType<typeof vi.fn> };

/** 창 — ack 면 받은 길(MessagePort)로 바로 '받았어'를 돌려준다(앱 MobileApp 이 하는 것) */
function win(ack: boolean): Win {
  const w: Win = {
    url: 'https://mac.tail.ts.net/',
    focused: false,
    postMessage: vi.fn((_m: unknown, ports?: MessagePort[]) => { if (ack) ports?.[0]?.postMessage(true); }),
    focus: vi.fn(async () => w),
    navigate: vi.fn(async () => w),
  };
  return w;
}

function boot(raw: string, wins: Win[]) {
  const handlers = new Map<string, Handler[]>();
  const shown: { title: string; opts: { body?: string; data?: { target?: string } } }[] = [];
  const opened: string[] = [];
  const self = {
    location: { origin: 'https://mac.tail.ts.net' },
    addEventListener: (t: string, f: Handler) => handlers.set(t, [...(handlers.get(t) ?? []), f]),
    skipWaiting: () => Promise.resolve(),
    clients: { claim: () => Promise.resolve(), matchAll: async () => wins, openWindow: async (u: string) => { opened.push(u); return null; } },
    registration: { showNotification: async (title: string, opts: never) => { shown.push({ title, opts }); } },
  };
  new Function('self', 'caches', 'fetch', raw)(self, {}, () => Promise.reject(new Error('no net')));
  const fire = async (type: string, extra: object) => {
    const waits: Promise<unknown>[] = [];
    for (const h of handlers.get(type) ?? []) h({ ...extra, waitUntil: (p: Promise<unknown>) => waits.push(p) });
    await Promise.all(waits);
  };
  const click = (target?: string) => fire('notificationclick', { notification: { close: () => {}, data: target === undefined ? {} : { target } } });
  return { fire, click, shown, opened };
}

afterEach(() => vi.useRealTimers());

describe('테일넷 서비스 워커 — 알림 누름', () => {
  it('푸시의 갈 곳을 알림에 싣는다', async () => {
    const sw = boot(tailRaw, []);
    await sw.fire('push', { data: { json: () => ({ title: '기획 결정 대기 — acme-platform', body: '운영에 올릴까?', target: 'card:o1:w:t1' }) } });
    expect(sw.shown[0]!.title).toBe('기획 결정 대기 — acme-platform');
    expect(sw.shown[0]!.opts.data).toEqual({ target: 'card:o1:w:t1' });
  });

  it('열린 창이 받으면 — 그 창을 앞으로, 갈 곳을 알린다(다시 읽지 않음)', async () => {
    const w = win(true);
    const sw = boot(tailRaw, [w]);
    await sw.click('card:o1:w:t1');
    expect(w.focus).toHaveBeenCalled();
    expect(w.postMessage.mock.calls[0]![0]).toEqual({ go: 'card:o1:w:t1' });
    expect(w.navigate).not.toHaveBeenCalled();
    expect(sw.opened).toEqual([]);
  });

  it('창이 답을 안 하면(옛 판·멈춘 페이지) 그 창을 갈 곳 주소로 다시 연다', async () => {
    vi.useFakeTimers();
    const w = win(false);
    const sw = boot(tailRaw, [w]);
    const done = sw.click('session:o2');
    await vi.advanceTimersByTimeAsync(3000);
    await done;
    expect(w.navigate).toHaveBeenCalledWith('/?go=session%3Ao2');
  });

  it('창이 없으면 갈 곳 주소로 새로 연다', async () => {
    const sw = boot(tailRaw, []);
    await sw.click('team:room-1');
    expect(sw.opened).toEqual(['/?go=team%3Aroom-1']);
  });

  it('갈 곳이 없는 알림(참모가 부른 푸시)은 컴퓨터의 마지막 알림 갈 곳으로(latest)', async () => {
    const sw = boot(tailRaw, []);
    await sw.click();
    expect(sw.opened).toEqual(['/?go=latest']);
  });

  it('여러 창이면 앞에 있는 창으로', async () => {
    const a = win(true);
    const b = { ...win(true), focused: true };
    const sw = boot(tailRaw, [a, b]);
    await sw.click('session:o1');
    expect(b.postMessage).toHaveBeenCalled();
    expect(a.postMessage).not.toHaveBeenCalled();
  });
});

describe('중계 입구 서비스 워커 — 본문 없는 푸시라 갈 곳은 latest', () => {
  it('창이 없으면 /?go=latest 로 연다', async () => {
    const sw = boot(relayRaw, []);
    await sw.click();
    expect(sw.opened).toEqual(['/?go=latest']);
  });

  it('열린 창이 받으면 latest 를 알리고 앞으로', async () => {
    const w = win(true);
    const sw = boot(relayRaw, [w]);
    await sw.click();
    expect(w.postMessage.mock.calls[0]![0]).toEqual({ go: 'latest' });
    expect(w.focus).toHaveBeenCalled();
    expect(w.navigate).not.toHaveBeenCalled();
  });
});
