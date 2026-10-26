// 폰이 컴퓨터 화면을 열기 — QR 대신 숫자 확인(ADR 0014). 내 계정 컴퓨터 허브를 내 기기 열쇠로 두드려 link1~5 를 주고받는다.
// 상자는 늘 받는 쪽 공개 열쇠로 봉한다(중계는 못 연다). 컴퓨터 열쇠(Mt)는 서버가 준 것이라 숫자로 확인한다 — 사람이 두 화면 숫자를 견준다
import { KNOCK_ERRORS, type Paired } from './knock';
import { phoneKeys } from './keys';
import { wsUrl } from './relayClient';
import { LinkRun, sasText } from './sas';
import { b64, open, seal, unb64 } from './tunnel';

/** 사람이 컴퓨터에서 누를 때까지 — 카드도 10분 */
const WAIT_MS = 10 * 60_000;
const enc = new TextEncoder();
const dec = new TextDecoder();

/** 컴퓨터 터널 공개 열쇠 모양(65바이트, 첫 바이트 0x04 — 압축 안 한 P-256 점, base64url 87자) — 서버가 준 남의 값이라 모양부터(진짜인지는 숫자 확인이 가린다) */
export const keyShape = (s: unknown): s is string => typeof s === 'string' && /^B[A-P][A-Za-z0-9_-]{85}$/.test(s) && unb64(s).length === 65;

export type Computer = { id: string; name: string; kind: string; tunnelPub: string; online: boolean | null };

export const LINK_ERRORS: Record<string, string> = {
  ...KNOCK_ERRORS,
  declined: '컴퓨터에서 거절했어요 — 숫자가 달랐다면 누군가 가운데 끼어든 거예요',
  device: '이 폰이 그 컴퓨터 계정에 없어요 — 같은 Chammo 계정으로 로그인했는지 봐 주세요',
  pair: '컴퓨터가 이 폰 줄을 못 만들었어요 — 다시 해 주세요',
  timeout: '10분 안에 컴퓨터에서 허용하지 않았어요 — 다시 해 주세요',
  busy: '숫자 확인을 너무 자주 했어요 — 10분 뒤 다시 해 주세요',
  mismatch: '숫자가 달랐다면 누군가 가운데 끼어든 거예요 — 이 폰엔 저장하지 않았어요. 컴퓨터 설정 > 기기 관리에서 이 폰을 빼 주세요',
  // 숫자 확인엔 QR 이 없다 — 옛 QR 문구(KNOCK_ERRORS.refused)를 덮는다(10-26 사용자 폰 '이 QR 을 못 열었어요')
  refused: '컴퓨터가 이 확인을 받지 않았어요 — 컴퓨터 Chammo 가 켜져 있고 같은 Chammo 계정으로 로그인돼 있는지 본 뒤 다시 눌러 주세요',
  cut: '허용을 받기 전에 확인이 끊겼어요 — 다시 눌러 새 숫자로 해 주세요. 컴퓨터에 남은 옛 숫자 카드는 닫아 주세요',
  replaced: '다른 화면에서 새 확인을 시작해서 이 확인은 닫혔어요',
};

/** onSas = 숫자를 화면에. confirm = 컴퓨터가 허용했다 — 폰에서도 사람이 '컴퓨터 숫자와 같았어요'를 눌러야 저장(양쪽 확인, 리뷰 1) */
export async function knockLink(relay: string, device: string, mac: Computer, onSas: (text: string) => void, confirm: (text: string) => Promise<boolean>): Promise<Paired> {
  const k = await phoneKeys();
  const mt = unb64(mac.tunnelPub);
  const run = new LinkRun({ pt: unb64(k.xPub), mt, sign: unb64(k.signPub), dev: device });
  let sas = '';
  const box = async (o: unknown) => b64(await seal(mt, enc.encode(JSON.stringify(o))));
  const unbox = async (s: string) => JSON.parse(dec.decode(await open(k.x.privateKey, unb64(k.xPub), unb64(s)))) as Record<string, unknown>;
  const ws = new WebSocket(await wsUrl(relay, `/v0/hubs/${mac.id}/knock`, k, device));
  const v = await new Promise<Record<string, unknown>>((ok, no) => {
    const t = setTimeout(() => { no(new Error(LINK_ERRORS.timeout)); ws.close(); }, WAIT_MS);
    const end = (f: () => void) => { clearTimeout(t); f(); };
    const fail = (why: string) => end(() => { no(new Error(LINK_ERRORS[why] ?? `확인 실패 (${why})`)); ws.close(); });
    // 단계 이름은 봉한 상자 안에 — 허브는 상자만 넘긴다
    const send = async (o: unknown) => ws.send(JSON.stringify({ t: 'knock', box: await box(o) }));
    // 받은 틀은 차례로 — 허브는 마지막 답(link5) 바로 뒤에 닫는데, 사파리는 닫힘을 상자 풀기(WebCrypto)보다 먼저 낸다.
    // 닫힘도 앞 틀을 다 푼 뒤에 본다(10-26 사용자 폰: 허용했는데 '못 열었어요', 시뮬레이터 사파리 20번 중 14~20번 닫힘이 먼저)
    let line: Promise<void> = Promise.resolve();
    const after = (f: () => void | Promise<void>) => { line = line.then(f, f); };
    ws.onopen = () => void run.link1().then(send, () => fail('net'));
    ws.onerror = () => after(() => fail('net'));
    // 숫자를 띄웠으면 끊긴 것(카드는 컴퓨터에 남는다), 아니면 컴퓨터가 안 받은 것. 4004 = 같은 폰의 새 확인이 이 소켓을 바꿨다
    ws.onclose = (ev) => after(() => fail(ev.code === 4004 ? 'replaced' : sas ? 'cut' : 'refused'));
    ws.onmessage = (ev) => after(async () => {
      let m: { t?: string; box?: string; code?: string };
      try { m = JSON.parse(String(ev.data)); } catch { return; }
      if (m.t === 'offline') return fail('offline');
      if (m.t === 'refused') return fail(sas ? 'cut' : 'refused');
      if (m.t === 'error') return fail(m.code === 'too_many_steps' ? 'busy' : 'refused');
      if (m.t !== 'reply' || typeof m.box !== 'string') return;
      await unbox(m.box).then(async (x) => {
        if (x.step === 'link2') {
          await send(await run.link2(unb64(String(x.cM ?? ''))));
        } else if (x.step === 'link4') {
          sas = sasText(await run.link4(unb64(String(x.nM ?? ''))));
          onSas(sas);
        } else if (x.step === 'link5') {
          // 숫자를 낸 뒤에만 — 숫자 없이 온 토큰은 가짜 컴퓨터일 수 있다
          if (!run.canFinish()) return fail('key');
          end(() => { ok(x); ws.close(); });
        } else {
          fail('key');
        }
      }).catch(() => fail('key'));
    });
  });
  if (v.ok !== true || typeof v.token !== 'string' || typeof v.device !== 'string') throw new Error(LINK_ERRORS[String(v.error ?? '')] ?? `확인 실패 (${String(v.error ?? '?')})`);
  if (!(await confirm(sas))) throw new Error(LINK_ERRORS.mismatch);
  const name = (v.mac as { name?: string } | undefined)?.name ?? mac.name;
  return { token: v.token, link: { relay, mac: mac.id, macX: mac.tunnelPub, device: v.device, macName: name } };
}
