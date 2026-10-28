// 떠 있는 참모 배지 v3 N(시안 docs/design-drafts/orch-bubble v3, 10-28 사용자 "이게 맞는 듯") — 앱 안 배지(OrchBubble)와 바탕 배지(DeskBubble)가 같이 쓴다.
// 원형 하나·가운데 얼굴 하나(급한 참모 → 마지막 대화), 테두리 = 얼굴 참모 상태 색(물어봄은 노란 물결), 아래 숫자 알약(물어봄 N·일함 N),
// 올리면 화면 가운데 쪽으로 1/4 원 부채 두 줄(안쪽 3·바깥 4 — 7명, 넘치면 6 + '+N' → 누르면 정돈된 목록). 얼굴이 바뀌면 위에서 톡(key 로 다시 그려 들어옴 움직임)
import { useEffect, useRef, useState } from 'react';
import { FAN_LEAVE_MS, FAN_OUT_MS, badgeCounts, fanPlan, fanRings, type Pt } from '../../domain/orchBubble';
import { motionOn } from '../calm';
import { orchVars } from '../../domain/orchTheme';
import { tr } from '../../i18n';

export type FanOrch = { id: string; label: string; color: string; pip?: 'ask' | 'new' | 'run' | 'rest' | null; small: React.ReactNode };
type Side = { x: 1 | -1; y: 1 | -1 };

const STATE = (p: FanOrch['pip']) => (p === 'ask' ? tr('물어봄', 'Asking') : p === 'new' ? tr('답 왔어', 'New reply') : p === 'run' ? tr('일하는 중', 'Working') : tr('쉬는 중', 'Resting'));
/** 테두리·점 색 이름 */
export const ringOf = (p: FanOrch['pip']) => (p === 'ask' ? 'ask' : p === 'new' ? 'new' : p === 'run' ? 'run' : 'rest');

/** 배지 안 — 테두리 고리 + 얼굴(바뀌면 톡) + 새 것 점 + 아래 숫자 알약 */
export function BadgeCore({ face, node, orchs }: { face: FanOrch; node: React.ReactNode; orchs: FanOrch[] }) {
  const c = badgeCounts(orchs);
  return (
    <>
      <span className={`obb-ring r-${ringOf(face.pip)}`} aria-hidden="true" />
      <span key={face.id} className="obb-facein obb-clip">{node}</span>
      {face.pip === 'new' && <i className="obb-dot" aria-hidden="true" />}
      {(c.ask > 0 || c.work > 0) && (
        <span className="obb-counts" aria-label={tr(`물어봄 ${c.ask}, 일함 ${c.work}`, `${c.ask} asking, ${c.work} working`)}>
          {c.ask > 0 && <span className="obb-cnt c-ask"><i />{c.ask}</span>}
          {c.work > 0 && <span className="obb-cnt"><i />{c.work}</span>}
        </span>
      )}
    </>
  );
}

/** 부채 — 배지 가운데(cx, cy, 창 좌표)에서 side 쪽으로. 이름은 올릴 때만 */
export function BubbleFan({ orchs, front, cx, cy, side, out = false, onPick, onEnter, onLeave }: {
  orchs: FanOrch[]; front: string; cx: number; cy: number; side: Side; out?: boolean;
  onPick: (id: string) => void; onEnter: () => void; onLeave: () => void;
}) {
  const [more, setMore] = useState(false);
  const plan = fanPlan(orchs, front);
  const byId = new Map(orchs.map((o) => [o.id, o]));
  const k = plan.shown.length + (plan.more.length ? 1 : 0);
  const pts = fanRings(k, side);
  return (
    <div className={`obb-fan${out ? ' out' : ''}`} style={{ left: cx, top: cy }} onPointerEnter={onEnter} onPointerLeave={onLeave} role="group" aria-label={tr('다른 참모', 'Other assistants')}>
      {plan.shown.map((id, i) => {
        const o = byId.get(id)!;
        return (
          <button data-hot key={id} type="button" className="obb-fo" style={{ ...(orchVars(o.color) as React.CSSProperties), transform: `translate(${pts[i]!.x}px, ${pts[i]!.y}px)`, '--fo-back': String(k - 1 - i) } as React.CSSProperties}
            aria-label={`${o.label} · ${STATE(o.pip)}`} onClick={() => onPick(id)}>
            <span className="obb-clip">{o.small}</span>{o.pip && o.pip !== 'rest' && <i className={`obb-fd r-${ringOf(o.pip)}`} aria-hidden="true" />}
            <span className={`obb-fn ${side.y < 0 ? 'up' : ''}`}>{o.label}</span>
          </button>
        );
      })}
      {plan.more.length > 0 && (
        <button type="button" className="obb-fo obb-fmore" style={{ transform: `translate(${pts[k - 1]!.x}px, ${pts[k - 1]!.y}px)`, '--fo-back': '0' } as React.CSSProperties}
          aria-label={tr(`나머지 참모 ${plan.more.length}명`, `${plan.more.length} more assistants`)} aria-expanded={more} onClick={() => setMore((m) => !m)}>+{plan.more.length}</button>
      )}
      {more && <MoreList ids={plan.more} byId={byId} side={side} onPick={onPick} />}
    </div>
  );
}

/** '+N' — 나머지 참모를 정돈된 목록으로(급한 참모 먼저, 얼굴 + 이름 + 상태 글, 많으면 목록 안 스크롤) */
function MoreList({ ids, byId, side, onPick }: { ids: string[]; byId: Map<string, FanOrch>; side: Side; onPick: (id: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { ref.current?.querySelector('button')?.focus(); }, []);
  return (
    <div ref={ref} className="obb-more" role="menu" style={{ [side.x < 0 ? 'right' : 'left']: -24, [side.y < 0 ? 'bottom' : 'top']: 156 } as React.CSSProperties} /* 부채 바깥(+N 위쪽)에 — 부채를 안 가린다 */>
      {ids.map((id) => {
        const o = byId.get(id)!;
        return (
          <button key={id} type="button" role="menuitem" className="obb-mr" style={orchVars(o.color) as React.CSSProperties} onClick={() => onPick(id)}>
            {o.small}<span className="obb-mn">{o.label}</span><span className={`obb-ms r-${ringOf(o.pip)}`}>{STATE(o.pip)}</span>
          </button>
        );
      })}
    </div>
  );
}

/** 올림 판정 — 배지·부채 위(over)거나 부채 둘레(keep, 마우스 자리) 안이면 머물고, 밖으로 나간 뒤 FAN_LEAVE_MS 에 접는다(시간보다 자리, 10-28 밤 사용자).
 *  접을 땐 얼굴들이 배지로 빨려 들어가는 동안(out) 그려 두고 FAN_OUT_MS 뒤 내린다 — 움직임 줄이기면 바로 */
export function useHoverFan(enabled: boolean, keep: (p: Pt | null) => boolean) {
  const [on, setOn] = useState(false);
  const [out, setOut] = useState(false);
  const t = useRef(0);
  const o = useRef(0);
  const onRef = useRef(false);
  const over = useRef(false);
  const at = useRef<Pt | null>(null);
  const keepRef = useRef(keep);
  keepRef.current = keep;
  onRef.current = on && enabled;
  const stop = () => { window.clearTimeout(t.current); t.current = 0; };
  const shut = (anim: boolean) => {
    stop();
    window.clearTimeout(o.current);
    const was = onRef.current;
    setOn(false);
    const fold = anim && was && motionOn();
    setOut(fold);
    if (fold) o.current = window.setTimeout(() => setOut(false), FAN_OUT_MS);
  };
  // 머물까 — 위거나 둘레 안이면 그대로, 밖이면 (한 번만) 여유 시간을 건다
  const judge = () => {
    if (!onRef.current || over.current || keepRef.current(at.current)) { stop(); return; }
    if (!t.current) t.current = window.setTimeout(() => { t.current = 0; shut(true); }, FAN_LEAVE_MS);
  };
  useEffect(() => { if (!enabled) { stop(); setOn(false); setOut(false); } }, [enabled]);
  useEffect(() => () => { stop(); window.clearTimeout(o.current); }, []);
  return {
    on: on && enabled,
    /** 그릴까 — 펴진 동안 + 접히는 동안 */
    shown: (on || out) && enabled,
    out: out && !on && enabled,
    enter: () => { over.current = true; stop(); if (enabled) { window.clearTimeout(o.current); setOut(false); setOn(true); } },
    leave: () => { over.current = false; judge(); },
    /** 창 안 마우스 자리(창 밖이면 null) */
    move: (p: Pt | null) => { at.current = p; judge(); },
    close: () => { over.current = false; shut(false); },
  };
}
