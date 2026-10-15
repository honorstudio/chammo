// 애니메이션 단계를 화면에 건다(판단은 domain/animCalm) — 문서 맨 위에 oa-calm(줄이기)·oa-still(끄기).
// 설정(features.animation)은 App 이, 맥 부하는 앱이 이미 읽는 부하 주기(데스크톱 useLoad · 폰 /api/load)가 넣는다 — 여기서 새로 재지 않는다.
// 줄이기: 도는 움직임은 paused.css 목록대로 멈추고, 0.1초 넘는 전환만 0.1초로(스타일시트를 훑어 덮개 규칙을 만든다 — 기본값 all 0초인 요소는 안 건드린다).
// 끄기: 움직임·전환 0(끝 모양으로 바로). 상태는 색·모양으로 남는다
import type { Animation } from '../domain/config';
import { calmOf, capDurations, stepHot, type Calm, type HotState } from '../domain/animCalm';

let setting: Animation = 'auto';
let hot: HotState = { hot: false, since: null };
let level: Calm = 'full';
let bound = false;
const subs = new Set<(c: Calm) => void>();

const osReduce = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

function bind() {
  if (bound || typeof window === 'undefined') return;
  bound = true;
  window.matchMedia?.('(prefers-reduced-motion: reduce)').addEventListener?.('change', apply);
}

/** 줄이기 덮개 — 지금 붙은 스타일시트에서 0.1초 넘는 전환을 0.1초로. 나중에 불러온 화면(지연 로드)의 시트도 잡게 켤 때마다 다시 짓는다 */
function calmSheet(): string {
  const out: string[] = [];
  const walk = (rules: CSSRuleList) => {
    for (const r of Array.from(rules)) {
      if (r instanceof CSSStyleRule) {
        const cap = capDurations(r.style.transitionDuration);
        if (cap) out.push(`${r.selectorText.split(',').map((s) => `html.oa-calm ${s.trim()}`).join(', ')} { transition-duration: ${cap} !important; }`);
      } else if ('cssRules' in r) {
        try { walk((r as CSSGroupingRule).cssRules); } catch { /* 못 읽는 묶음 */ }
      }
    }
  };
  for (const sh of Array.from(document.styleSheets)) {
    if ((sh.ownerNode as Element | null)?.id === 'oa-calm-css') continue;
    try { walk(sh.cssRules); } catch { /* 다른 출처 시트 */ }
  }
  return out.join('\n');
}

function apply() {
  const next = calmOf(setting, osReduce(), hot.hot);
  if (typeof document === 'undefined') { level = next; return; }
  const root = document.documentElement;
  if (next === 'reduce') {
    let el = document.getElementById('oa-calm-css');
    if (!el) { el = document.createElement('style'); el.id = 'oa-calm-css'; document.head.appendChild(el); }
    if (next !== level || !el.textContent) el.textContent = calmSheet();
  }
  root.classList.toggle('oa-calm', next === 'reduce');
  root.classList.toggle('oa-still', next === 'off');
  if (next === level) return;
  level = next;
  subs.forEach((f) => f(level));
}

/** 설정 > 기능 > 애니메이션 */
export function setAnimation(a: Animation) {
  bind();
  setting = a;
  apply();
}

/** 맥 부하를 잴 때마다(1분 부하·코어 수) — 높음 10초·낮음 30초 이어져야 바뀐다(domain/animCalm stepHot) */
export function feedLoad(s: { load1: number; cores: number } | null, now = Date.now()) {
  bind();
  hot = stepHot(hot, s, now);
  apply();
}

/** 지금 단계 */
export const calmLevel = (): Calm => level;
/** JS 로 움직이는 것(이음 탭·자리 옮김·말하는 빛·참모 바꾸기 기다림)이 움직여도 되나 — 줄이기·끄기·OS 동작 줄이기면 아니다 */
export const motionOn = (): boolean => calmOf(setting, osReduce(), hot.hot) === 'full';

export function onCalm(f: (c: Calm) => void): () => void {
  subs.add(f);
  return () => subs.delete(f);
}
