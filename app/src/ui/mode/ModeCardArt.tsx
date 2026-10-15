// 고르기 카드 그림(10/12 사용자) — 데스크톱·폰 고르기 시트가 같이 쓴다. 모드가 정한 그림(chammo.json card)은 object-fit cover 그림으로,
// 없으면 마지막으로 그려진 칸을 같은 렌더러로 크게 그려 작게 줄인다(누를 수 없는 그림). 그것도 없으면 fallback(지금 자리표시)
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { cardView, type CardView } from '../../domain/modeCard';
import { ModeEnvCtx, Node, type Drafts } from './ModeTree';

// 시트를 열 때마다 묻지 않게 — 모드마다 1분
const cache = new Map<string, { at: number; v: CardView | null }>();
const TTL = 60_000;
const TREE_W = 240; // 칸 트리를 이 폭으로 그려 카드 폭에 맞춰 줄인다(넓을수록 글이 작아진다)
const NOOP_ENV = { open: () => {}, client: null };
const NO_DRAFTS: Drafts = new Map();

export function useModeCard(name: string, load: (name: string) => Promise<unknown>): CardView | null {
  const hit = cache.get(name);
  const [v, setV] = useState<CardView | null>(hit?.v ?? null);
  useEffect(() => {
    const c = cache.get(name);
    if (c && Date.now() - c.at < TTL) { setV(c.v); return; }
    let alive = true;
    void load(name).then((raw) => cardView(raw), () => null).then((x) => {
      cache.set(name, { at: Date.now(), v: x });
      if (alive) setV(x);
    });
    return () => { alive = false; };
  }, [name, load]);
  return v;
}

function TreeShot({ tree }: { tree: Extract<CardView, { kind: 'tree' }>['tree'] }) {
  const box = useRef<HTMLSpanElement>(null);
  const [scale, setScale] = useState(0.4);
  useLayoutEffect(() => { const w = box.current?.clientWidth; if (w) setScale(w / TREE_W); }, []);
  return (
    <span className="mdv-card-shot" ref={box}>
      <span className="mdv compact mdv-card-tree" style={{ width: TREE_W, transform: `scale(${scale})` }} inert>
        <ModeEnvCtx.Provider value={NOOP_ENV}><Node n={tree} onAct={() => {}} drafts={NO_DRAFTS} /></ModeEnvCtx.Provider>
      </span>
    </span>
  );
}

/** 카드 그림 — art 가 있으면 그것, 없으면 fallback */
export function ModeCardArt({ art, fallback }: { art: CardView | null; fallback: ReactNode }) {
  if (!art) return <>{fallback}</>;
  return art.kind === 'img' ? <img className="mdv-card-img" src={art.src} alt="" draggable={false} /> : <TreeShot tree={art.tree} />;
}
