// 폰 숫자 확인(ADR 0014) — QR 대신 양쪽 화면 6자리. 컴퓨터 쪽은 Rust device_link(같은 식·같은 표식).
// 5단계: ① 폰 cP → ② 컴퓨터 cM → ③ 폰 nP → ④ 컴퓨터 nM(cM 과 대조) → 숫자 → ⑤ 토큰. 양쪽이 봉해 두고 연다 —
// 중계는 어느 쪽 숫자든 알기 전에 패를 먼저 깨야 해서 숫자를 미리 맞추지 못한다(리뷰 2차 심각)
import { b64 } from './tunnel';

const enc = new TextEncoder();
const COMMIT_TAG = enc.encode('chammo-link-commit/1');
const COMMIT_M_TAG = enc.encode('chammo-link-commit-m/1');
const SAS_TAG = enc.encode('chammo-link-sas/1');

const sha = async (...parts: Uint8Array[]) => {
  const all = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { all.set(p, at); at += p.length; }
  return new Uint8Array(await crypto.subtle.digest('SHA-256', all as Uint8Array<ArrayBuffer>));
};

export const commitOf = (pt: Uint8Array, np: Uint8Array) => sha(COMMIT_TAG, pt, np);
export const commitMOf = (mt: Uint8Array, nm: Uint8Array) => sha(COMMIT_M_TAG, mt, nm);
/** 숫자 = SHA256(표식 ‖ Pt ‖ Mt ‖ 서명 열쇠 ‖ 기기 id(utf8) ‖ nP ‖ nM) 앞 4바이트 mod 10⁶ — Rust device_link::sas 와 같은 식 */
export async function sasOf(pt: Uint8Array, mt: Uint8Array, sign: Uint8Array, dev: string, np: Uint8Array, nm: Uint8Array): Promise<number> {
  const h = await sha(SAS_TAG, pt, mt, sign, enc.encode(dev), np, nm);
  return (((h[0]! << 24) >>> 0) + (h[1]! << 16) + (h[2]! << 8) + h[3]!) % 1_000_000;
}
export const sasText = (n: number) => { const s = String(n).padStart(6, '0'); return `${s.slice(0, 3)} ${s.slice(3)}`; };

const same = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i]);

/** 한 컴퓨터와 한 번의 숫자 확인 — 단계를 차례로만 */
export class LinkRun {
  private sent1 = false;
  private cm: Uint8Array | null = null;
  private done = false;
  constructor(private k: { pt: Uint8Array; mt: Uint8Array; sign: Uint8Array; dev: string }, private np: Uint8Array = crypto.getRandomValues(new Uint8Array(16))) {}
  /** ① 인사 — cP 만, nP 는 아직. 내 기기 id 를 봉한 상자에 넣는다(컴퓨터가 허브가 말한 기기와 대조) */
  async link1(ua = typeof navigator === 'undefined' ? '' : navigator.userAgent) {
    this.sent1 = true;
    return { step: 'link1', sign: b64(this.k.sign), x: b64(this.k.pt), ua, commit: b64(await commitOf(this.k.pt, this.np)), dev: this.k.dev };
  }
  /** ② 컴퓨터 cM 을 받았다 → ③ 이제야 nP 를 연다 */
  async link2(cm: Uint8Array): Promise<{ step: 'link3'; nP: string }> {
    if (!this.sent1) throw new Error('order');
    if (this.cm) throw new Error('once');
    if (cm.length !== 32) throw new Error('bad cM');
    this.cm = cm;
    return { step: 'link3', nP: b64(this.np) };
  }
  /** ④ 컴퓨터 nM — cM 과 맞아야 숫자 */
  async link4(nm: Uint8Array): Promise<number> {
    if (!this.cm || this.done) throw new Error('order');
    if (nm.length !== 16 || !same(await commitMOf(this.k.mt, nm), this.cm)) throw new Error('commit');
    this.done = true;
    return sasOf(this.k.pt, this.k.mt, this.k.sign, this.k.dev, this.np, nm);
  }
  /** ⑤ 토큰을 받아도 되나 — 숫자를 낸 뒤에만 */
  canFinish() {
    return this.done;
  }
}
