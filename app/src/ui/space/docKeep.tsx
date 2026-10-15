// 최근 참모 문서 살려 두기(domain/docKeep) — 참모마다 가운데 문서(DocPage) 하나를 포털로 그려 두고, 그 포털 상자를 자리(DocSlot)에 붙였다 뗐다 한다.
// 참모를 바꾸면 화면 나무가 바뀌어 편집기가 부서졌다 — 상자는 SpaceView 맨 위(host)에서 늘 그려져서 자리만 옮긴다.
// 자리에 안 붙은 상자는 문서에서 떨어져 있어 그리지도 않는다. 보이는지는 SpaceShown 으로 알린다 — 숨은 편집기는 바깥 고침 감시(docSync)를 멈춘다
import { createContext, useContext, useEffect, useLayoutEffect, useRef, type ReactElement } from 'react';
import { createPortal } from 'react-dom';
import { keepTouch } from '../../domain/docKeep';

/** 이 문서가 지금 화면에 보이나 — 살려 둔(숨은) 편집기는 false */
export const SpaceShown = createContext(true);

/** 보이는지(ref — 감시 주기 안에서 읽는다). 숨었다가 다시 보이면 onShow 한 번(그사이 바깥에서 고친 걸 바로 받게) */
export function useShownRef(onShow?: () => void) {
  const shown = useContext(SpaceShown);
  const ref = useRef(shown);
  const was = useRef(shown);
  ref.current = shown;
  useEffect(() => {
    if (shown && !was.current) onShow?.();
    was.current = shown;
  }, [shown]); // eslint-disable-line react-hooks/exhaustive-deps
  return ref;
}

type Kept = { key: string; el: ReactElement; box: HTMLDivElement };

export function useDocKeep() {
  const kept = useRef(new Map<string, Kept>()); // 참모 id → 그 참모 문서
  const order = useRef<string[]>([]);
  const cur = useRef<string | null>(null);
  const frozen = useRef(false);
  return {
    /** 렌더 시작 — frozen = 참모를 바꾸는 움직임 중(옛 화면을 그대로 두는 동안 새 문서를 만들지 않는다, domain/switchHold) */
    begin(isFrozen: boolean) {
      frozen.current = isFrozen;
      if (!isFrozen) cur.current = null;
    },
    /** 가운데 문서 — 그 참모 칸으로 살려 두고 자리를 돌려준다. 같은 참모가 다른 문서를 열면 옛 것은 내린다 */
    slot(orch: string, path: string, el: ReactElement, limit: number): ReactElement | null {
      if (frozen.current) return null; // 움직이는 동안엔 안 보인다(옛 화면이 덮여 있다)
      const key = `${orch}\u0000${path}`;
      const had = kept.current.get(orch);
      const box = had && had.key === key ? had.box : Object.assign(document.createElement('div'), { className: 'cv-keep-box' });
      kept.current.set(orch, { key, el, box });
      const t = keepTouch(order.current, orch, limit);
      order.current = t.order;
      for (const id of t.drop) kept.current.delete(id);
      cur.current = key;
      return <DocSlot key={key} box={box} />;
    },
    /** SpaceView 맨 위에 늘 그린다 — 살려 둔 문서 전부(포털), 지금 자리에 붙은 것만 보인다 */
    host(): ReactElement {
      return <>{[...kept.current.values()].map((k) => createPortal(<SpaceShown.Provider value={k.key === cur.current}>{k.el}</SpaceShown.Provider>, k.box, k.key))}</>;
    },
  };
}

/** 문서 자리 — 붙어 있는 동안 그 참모의 상자를 안에 둔다 */
function DocSlot({ box }: { box: HTMLDivElement }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const at = ref.current;
    if (!at) return;
    at.appendChild(box);
    return () => { if (box.parentNode === at) at.removeChild(box); };
  }, [box]);
  return <div ref={ref} className="cv-keep-slot" />;
}
