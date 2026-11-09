// 폰 허용 메일 코드(폰 쪽, 맥은 phone_mail_link.rs) — 코드 넣기는 두드리기 하나로 끝난다. 폰은 소켓을 쥐고 기다리지 않으니 메일 앱에 다녀와도 끊길 게 없고,
// 진행(어느 컴퓨터에 코드를 받았나)은 저장소에 둬서 새로고침·앱 전환 뒤에도 코드 화면으로 돌아온다. 코드는 저장하지 않는다
import { phoneKeys } from './keys';
import { keyShape, LINK_ERRORS, type Computer } from './linkKnock';
import type { Paired } from './knock';
import { wsUrl } from './relayClient';
import { b64, open, seal, unb64 } from './tunnel';

/** 맥 MAIL_TTL 과 같게 */
export const MAIL_TTL_MS = 10 * 60_000;
const KEY = 'chammo.mailLink';
const WAIT_MS = 30_000;
const enc = new TextEncoder();
const dec = new TextDecoder();

export type MailStore = { get: (k: string) => string | null; set: (k: string, v: string | null) => void };
export type MailState = { mac: Computer; device: string; at: number };

export function clearMail(s: MailStore) {
  s.set(KEY, null);
}

/** 기다리는 코드 — 이 기기 것이고 10분 안일 때만. 아니면 지운다. 저장소 글은 남이 넣을 수 있으니 모양부터 */
export function readMail(s: MailStore, device: string, now: number): MailState | null {
  let v: Partial<MailState> | null = null;
  try { v = JSON.parse(s.get(KEY) ?? 'null') as Partial<MailState> | null; } catch { /* 깨진 글 */ }
  const m = v?.mac;
  const ok = !!v && v.device === device && typeof v.at === 'number' && v.at <= now && now - v.at < MAIL_TTL_MS && !!m && typeof m.id === 'string' && typeof m.name === 'string' && keyShape(m.tunnelPub);
  if (!ok) { clearMail(s); return null; }
  return v as MailState;
}

/** 코드를 받았다 — 같은 컴퓨터로 다시 받으면 처음 때를 그대로(맥 코드도 처음부터 10분) */
export function saveMail(s: MailStore, device: string, mac: Computer, now: number) {
  const was = readMail(s, device, now);
  s.set(KEY, JSON.stringify({ mac, device, at: was?.mac.id === mac.id ? was.at : now }));
}

export type MailErrorKind = 'wrong' | 'locked' | 'expired' | 'off' | 'net' | 'other';
export class MailCodeError extends Error {
  override name = 'MailCodeError';
  constructor(readonly kind: MailErrorKind, readonly left = 0, text: string = kind) {
    super(text);
  }
}

/** 코드 화면에 보일 한 줄 */
export function mailNote(e: unknown): string {
  if (!(e instanceof MailCodeError)) return e instanceof Error ? e.message : String(e);
  switch (e.kind) {
    case 'wrong': return `코드가 달라요. ${e.left}번 더 넣을 수 있어요.`;
    case 'locked': return '코드를 5번 틀렸어요. 10분 뒤 새 코드를 받아 주세요.';
    case 'expired': return '코드가 끝났어요. 메일을 다시 받아 주세요.';
    case 'off': return '이 컴퓨터는 메일 코드를 쓰지 않아요. 처음부터 다시 해 주세요.';
    case 'net': return '연결이 끊겼어요. 다시 눌러 주세요.';
    default: return e.message;
  }
}

/** 코드 넣기 — 답(link5)을 받으면 끝. 허브는 답 바로 뒤에 닫는데 사파리는 닫힘을 상자 풀기보다 먼저 내서 받은 틀과 닫힘을 한 줄로 차례 처리한다(knockLink 와 같은 까닭) */
export async function knockCode(relay: string, device: string, mac: Computer, code: string): Promise<Paired> {
  const k = await phoneKeys();
  const mt = unb64(mac.tunnelPub);
  const ws = new WebSocket(await wsUrl(relay, `/v0/hubs/${mac.id}/knock`, k, device));
  const v = await new Promise<Record<string, unknown>>((ok, no) => {
    const t = setTimeout(() => { no(new MailCodeError('net')); ws.close(); }, WAIT_MS);
    const end = (f: () => void) => { clearTimeout(t); f(); };
    const fail = (e: MailCodeError) => end(() => { no(e); ws.close(); });
    let line: Promise<void> = Promise.resolve();
    const after = (f: () => void | Promise<void>) => { line = line.then(f, f); };
    ws.onopen = () => void seal(mt, enc.encode(JSON.stringify({ step: 'mail-code', sign: k.signPub, x: k.xPub, ua: typeof navigator === 'undefined' ? '' : navigator.userAgent, dev: device, code })))
      .then((b) => ws.send(JSON.stringify({ t: 'knock', box: b64(b) })), () => fail(new MailCodeError('net')));
    ws.onerror = () => after(() => fail(new MailCodeError('net')));
    ws.onclose = () => after(() => fail(new MailCodeError('net')));
    ws.onmessage = (ev) => after(async () => {
      let m: { t?: string; box?: string };
      try { m = JSON.parse(String(ev.data)); } catch { return; }
      if (m.t === 'offline') return fail(new MailCodeError('other', 0, LINK_ERRORS.offline!));
      if (m.t === 'refused' || m.t === 'error') return fail(new MailCodeError('other', 0, LINK_ERRORS.refused!));
      if (m.t !== 'reply' || typeof m.box !== 'string') return;
      const x = await open(k.x.privateKey, unb64(k.xPub), unb64(m.box)).then((b) => JSON.parse(dec.decode(b)) as Record<string, unknown>).catch(() => null);
      if (x?.step !== 'link5') return fail(new MailCodeError('other', 0, LINK_ERRORS.key!));
      end(() => { ok(x); ws.close(); });
    });
  });
  if (v.ok !== true || typeof v.token !== 'string' || typeof v.device !== 'string') {
    const why = String(v.error ?? '');
    if (why === 'wrong') throw new MailCodeError('wrong', typeof v.left === 'number' ? v.left : 0);
    if (why === 'locked' || why === 'expired' || why === 'off') throw new MailCodeError(why);
    throw new MailCodeError('other', 0, LINK_ERRORS[why] ?? `확인 실패 (${why || '?'})`);
  }
  const name = (v.mac as { name?: string } | undefined)?.name ?? mac.name;
  return { token: v.token, link: { relay, mac: mac.id, macX: mac.tunnelPub, device: v.device, macName: name } };
}
