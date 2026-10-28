// 칸·모달 숨은 글칸 → 세션 브라우저 페이지 글(2026-10-28 사용자 "네이버에서 유튜브 치면 유튜브브").
// 예전엔 조합이 끝날 때마다 글칸을 비우고 그 글을 보냈는데, 맥 웹뷰(WebKit)는 조합을 끝내는 Enter 때 비운 글칸에 글을 되살려(input isComposing=false)
// 같은 글자가 두 번 갔다. 이제 글칸은 그대로 두고 '페이지가 받은 글'과의 차이만 보낸다 — 되살아나도 차이 0, macOS 26 기본 입력기의
// 바꿔치기(앞 글자를 지우고 다시 넣기)도 지우기 + 넣기로 그대로 따라간다. 조합 중 글자는 페이지 입력칸 그 자리에 조합으로 미리 보인다(Input.imeSetComposition)
import { phoneKey, type InputEv } from './agentInput';

const cps = (s: string) => [...s];

export class TypeMirror {
  /** 페이지가 받았다고 아는 글칸 글 */
  private sent = '';
  /** 페이지에 조합 중 글자를 띄워 뒀나 */
  private composing = false;
  /** 칸을 눌러 조합이 끊겼다 — 크롬이 조합 글자를 그 자리에 남겼으니 이어지는 조합 끝은 안 넣는다 */
  private cut = false;

  /** 글칸 값과의 차이 — 지우기(Backspace) n번 + 넣기. 페이지에 조합이 떠 있으면 지우기 전에 걷는다 */
  private diff(value: string): InputEv[] {
    const a = cps(this.sent);
    const b = cps(value);
    let p = 0;
    while (p < a.length && p < b.length && a[p] === b[p]) p++;
    const out: InputEv[] = [];
    const del = a.length - p;
    if (del > 0 && this.composing) { out.push({ kind: 'compose', text: '' }); this.composing = false; }
    for (let i = 0; i < del; i++) out.push(...phoneKey('Backspace'));
    const ins = b.slice(p).join('');
    // insertText 는 떠 있는 조합을 바꿔 넣는다(크롬 ImeCommitText)
    if (ins) { out.push({ kind: 'text', text: ins }); this.composing = false; }
    this.sent = value;
    return out;
  }

  /** input 사건 — 조합 중이면 기다린다(조합 끝이 넣는다) */
  input(value: string, isComposing: boolean): InputEv[] {
    if (isComposing) return [];
    return this.diff(value);
  }

  /** compositionupdate — 조합 중 글자를 페이지에 미리 */
  compose(data: string): InputEv[] {
    if (this.cut) return [];
    this.composing = data !== '';
    return [{ kind: 'compose', text: data }];
  }

  /** compositionend — 글칸 값과의 차이를 넣는다. 아직 안 바뀌었으면 조합만 걷고 뒤따르는 input 이 넣는다 */
  end(value: string): InputEv[] {
    if (this.cut) { this.cut = false; this.composing = false; this.sent = value; return []; }
    const out = this.diff(value);
    if (this.composing) { out.push({ kind: 'compose', text: '' }); this.composing = false; }
    return out;
  }

  /** Enter — 마지막 글자부터(조합을 끝내는 229 Enter 는 compositionend 뒤에 와도, 그 전에 와도) 넣고 Enter */
  enter(_keyCode: number, value: string): InputEv[] {
    const out = this.diff(value);
    if (this.composing) { out.push({ kind: 'compose', text: '' }); this.composing = false; }
    const k = { key: 'Enter', code: 'Enter', keyCode: 13, altKey: false, ctrlKey: false, metaKey: false, shiftKey: false };
    return [...out, { kind: 'key', type: 'rawKeyDown', ...strip(k) }, { kind: 'key', type: 'char', ...strip(k), text: '\r' }, { kind: 'key', type: 'keyUp', ...strip(k) }];
  }

  /** 키 하나를 보내기 전 — 글칸에서 아직 안 간 차이를 먼저 */
  flush(value: string): InputEv[] {
    return this.diff(value);
  }

  /** 지우기를 글칸이 맡을까 — 글칸에 글이 있으면(macOS 26 입력기가 그 글로 자모를 다시 묶는다) 글칸이 지우고 차이가 간다 */
  nativeBackspace(value: string): boolean {
    return value.length > 0;
  }

  /** 칸을 눌렀다 — 조합 중이면 크롬이 그 글자를 그 자리에 남긴다(mousedown 이 조합을 끝냄) */
  clicked() {
    if (this.composing) this.cut = true;
    this.composing = false;
  }

  /** 새로 시작(Enter·화살표·Tab 뒤, 글칸을 비운 뒤) */
  reset() {
    this.sent = '';
    this.composing = false;
    this.cut = false;
  }
}

const strip = (k: { key: string; code: string; keyCode: number }) => ({ key: k.key, code: k.code, keyCode: k.keyCode, modifiers: 0 });
