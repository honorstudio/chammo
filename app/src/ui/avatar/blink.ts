// 깜빡임은 6~8초에 한 번, 0.2~0.7초만 — 예전엔 눈꺼풀 키프레임이 무한으로 돌아 사람이 안 볼 때도 프레임마다 다시 그렸다(2026-10-04 mac-perf).
// 타이머 하나가 모든 프사를 맡는다. 사람이 안 보면(ui/attention) 타이머도 멈추고 감은 눈으로 남지 않게 바로 뗀다
import { nextBlinkMs } from '../../domain/attention';
import { isAttended, onAttention } from '../attention';

const BLINK_MS = 800; // CSS 한 번(쉼 0.7초)보다 조금 길게
const due = new Map<Element, number>();
let timer = 0;
let bound = false;

function schedule() {
  window.clearTimeout(timer);
  timer = 0;
  if (!isAttended() || !due.size) return;
  const first = Math.min(...due.values());
  timer = window.setTimeout(fire, Math.max(0, first - Date.now()));
}

function fire() {
  const now = Date.now();
  for (const [el, at] of due) {
    if (at > now) continue;
    if (!el.classList.contains('oa-hidden')) {
      el.classList.add('oa-blink');
      window.setTimeout(() => el.classList.remove('oa-blink'), BLINK_MS);
    }
    due.set(el, now + nextBlinkMs(Math.random()));
  }
  schedule();
}

function bind() {
  if (bound) return;
  bound = true;
  onAttention((on) => {
    if (!on) for (const el of due.keys()) el.classList.remove('oa-blink');
    else { const now = Date.now(); for (const el of due.keys()) due.set(el, now + nextBlinkMs(Math.random())); }
    schedule();
  });
}

/** 이 프사를 깜빡임 차례에 넣는다 — 돌려준 함수로 뺀다 */
export function blinkWatch(el: Element): () => void {
  bind();
  due.set(el, Date.now() + nextBlinkMs(Math.random()));
  schedule();
  return () => {
    due.delete(el);
    el.classList.remove('oa-blink');
    schedule();
  };
}
