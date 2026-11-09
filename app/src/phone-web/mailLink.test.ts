// 폰 허용 메일 코드 — 코드 넣기는 두드리기 하나(앱을 오가도 끊길 소켓이 없다), 진행은 저장소에. 가짜 허브·가짜 컴퓨터로
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { b64, ECDH, open, seal, unb64 } from './tunnel';

const enc = new TextEncoder();
const dec = new TextDecoder();
const subtle = globalThis.crypto.subtle;
const raw = async (k: CryptoKey) => new Uint8Array(await subtle.exportKey('raw', k));
let phone: { sign: CryptoKeyPair; x: CryptoKeyPair; signPub: string; xPub: string };
vi.mock('./keys', () => ({ phoneKeys: async () => phone }));
vi.mock('./relayClient', () => ({ wsUrl: async () => 'wss://relay.test/v0/hubs/mac1/knock' }));

const { clearMail, knockCode, mailNote, MAIL_TTL_MS, MailCodeError, readMail, saveMail } = await import('./mailLink');

type Reply = (body: Record<string, string>) => unknown;
const macKeys = (await subtle.generateKey(ECDH, true, ['deriveBits'])) as CryptoKeyPair;
const macPub = await raw(macKeys.publicKey);
const computer = { id: 'mac1', name: 'MacBook', kind: 'full', tunnelPub: b64(macPub), online: true };

class FakeWs {
  static reply: Reply = () => null;
  static dropAfterSend = false;
  static last: FakeWs;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: ((ev: { code: number }) => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  bodies: Record<string, string>[] = [];
  closed = false;
  constructor() { FakeWs.last = this; setTimeout(() => this.onopen?.(), 0); }
  close() { this.closed = true; }
  async send(s: string) {
    const m = JSON.parse(s) as { t: string; box: string };
    const body = JSON.parse(dec.decode(await open(macKeys.privateKey, macPub, unb64(m.box)))) as Record<string, string>;
    this.bodies.push(body);
    if (FakeWs.dropAfterSend) { setImmediate(() => this.onclose?.({ code: 1006 })); return; }
    const box = b64(await seal(unb64(body.x!), enc.encode(JSON.stringify(FakeWs.reply(body)))));
    this.onmessage?.({ data: JSON.stringify({ t: 'reply', box }) });
    // 허브는 end 답 바로 뒤에 닫는다 — 사파리는 닫힘을 상자 풀기보다 먼저 낸다
    setImmediate(() => this.onclose?.({ code: 1000 }));
  }
}
vi.stubGlobal('WebSocket', FakeWs);

beforeEach(async () => {
  const sign = (await subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])) as CryptoKeyPair;
  const x = (await subtle.generateKey(ECDH, true, ['deriveBits'])) as CryptoKeyPair;
  phone = { sign, x, signPub: b64(await raw(sign.publicKey)), xPub: b64(await raw(x.publicKey)) };
  FakeWs.dropAfterSend = false;
});

const mem = () => { const m = new Map<string, string>(); return { get: (k: string) => m.get(k) ?? null, set: (k: string, v: string | null) => { if (v === null) m.delete(k); else m.set(k, v); } }; };

describe('코드 넣기', () => {
  it('맞으면 토큰·링크 — 상자에 코드·내 열쇠·기기 id 를 넣어 컴퓨터에만', async () => {
    FakeWs.reply = () => ({ step: 'link5', ok: true, token: 't'.repeat(43), device: 'dev-phone', mac: { name: '사용자 맥' } });
    const r = await knockCode('https://relay.test', 'dev-phone', computer, '123456');
    expect(r.token).toBe('t'.repeat(43));
    expect(r.link).toEqual({ relay: 'https://relay.test', mac: 'mac1', macX: computer.tunnelPub, device: 'dev-phone', macName: '사용자 맥' });
    const b = FakeWs.last.bodies[0]!;
    expect(b).toMatchObject({ step: 'mail-code', code: '123456', dev: 'dev-phone', sign: phone.signPub, x: phone.xPub });
    expect(FakeWs.last.closed).toBe(true);
  });

  it('틀리면 남은 횟수와 함께 — 허브가 답 뒤 바로 닫아도 답을 놓치지 않는다', async () => {
    FakeWs.reply = () => ({ step: 'link5', ok: false, error: 'wrong', left: 3 });
    const e = await knockCode('https://relay.test', 'dev-phone', computer, '000000').catch((x: unknown) => x);
    expect(e).toBeInstanceOf(MailCodeError);
    expect((e as InstanceType<typeof MailCodeError>).kind).toBe('wrong');
    expect(mailNote(e)).toContain('3번');
  });

  it('다섯 번 틀림·만료·끈 맥을 가른다', async () => {
    for (const error of ['locked', 'expired', 'off']) {
      FakeWs.reply = () => ({ step: 'link5', ok: false, error });
      const e = await knockCode('https://relay.test', 'dev-phone', computer, '000000').catch((x: unknown) => x);
      expect((e as InstanceType<typeof MailCodeError>).kind).toBe(error);
      expect(mailNote(e).length).toBeGreaterThan(3);
    }
  });

  it('답 전에 소켓이 끊기면 코드를 안 쓴 것처럼 다시 낼 수 있게 — net', async () => {
    FakeWs.dropAfterSend = true;
    const e = await knockCode('https://relay.test', 'dev-phone', computer, '123456').catch((x: unknown) => x);
    expect((e as InstanceType<typeof MailCodeError>).kind).toBe('net');
  });

  it('토큰 없는 성공 답은 믿지 않는다', async () => {
    FakeWs.reply = () => ({ step: 'link5', ok: true, device: 'dev-phone' });
    await expect(knockCode('https://relay.test', 'dev-phone', computer, '123456')).rejects.toBeInstanceOf(MailCodeError);
  });
});

describe('진행 저장 — 새로고침·앱 전환 뒤 코드 화면으로', () => {
  const NOW = 1_800_000_000_000;
  it('저장한 걸 다시 읽는다', () => {
    const s = mem();
    saveMail(s, 'dev1', computer, NOW);
    expect(readMail(s, 'dev1', NOW + 1000)).toEqual({ mac: computer, device: 'dev1', at: NOW });
  });
  it('10분 지나면 없는 것으로(지운다) — 경계', () => {
    const s = mem();
    saveMail(s, 'dev1', computer, NOW);
    expect(readMail(s, 'dev1', NOW + MAIL_TTL_MS - 1)).not.toBeNull();
    expect(readMail(s, 'dev1', NOW + MAIL_TTL_MS)).toBeNull();
    expect(s.get('chammo.mailLink')).toBeNull();
  });
  it('다시 받기는 처음 받은 때를 안 밀어낸다 — 같은 컴퓨터면', () => {
    const s = mem();
    saveMail(s, 'dev1', computer, NOW);
    saveMail(s, 'dev1', computer, NOW + 5000);
    expect(readMail(s, 'dev1', NOW + 6000)!.at).toBe(NOW);
    saveMail(s, 'dev1', { ...computer, id: 'mac2' }, NOW + 7000);
    expect(readMail(s, 'dev1', NOW + 8000)!.at).toBe(NOW + 7000);
  });
  it('다른 기기 id(다시 로그인)·깨진 글·남이 넣은 모양은 버린다', () => {
    const s = mem();
    saveMail(s, 'dev1', computer, NOW);
    expect(readMail(s, 'dev2', NOW)).toBeNull();
    s.set('chammo.mailLink', '깨진 글');
    expect(readMail(s, 'dev1', NOW)).toBeNull();
    s.set('chammo.mailLink', JSON.stringify({ mac: { ...computer, tunnelPub: 'x' }, device: 'dev1', at: NOW }));
    expect(readMail(s, 'dev1', NOW)).toBeNull();
    s.set('chammo.mailLink', JSON.stringify({ mac: computer, device: 'dev1', at: NOW + MAIL_TTL_MS * 2 }));
    expect(readMail(s, 'dev1', NOW), '미래 시각').toBeNull();
  });
  it('지우기', () => {
    const s = mem();
    saveMail(s, 'dev1', computer, NOW);
    clearMail(s);
    expect(readMail(s, 'dev1', NOW)).toBeNull();
  });
});
