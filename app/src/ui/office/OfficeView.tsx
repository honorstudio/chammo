import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ARRIVE_MS, arrival, bossReaction, catWalk, coffeeWalk, type BossReact, type Delivery, type Room } from '../../domain/office';
import { titleText } from '../gacha/icons';
import type { ActivityStatus } from '../../domain/status';
import { drawRoom, POOF_MS, roomSize, type Brush, type Deco, type Poof, type Spot } from './draw';
import { skinOf } from './skins';
import { allTags, fewTags } from './tags';
import { tr } from '../../i18n';
import { isAttended } from '../attention';
import './room.css';

const FRAME_MS = 120; // 도트 느낌 — 초당 8장쯤(펑이 너무 뚝뚝 끊기지 않게)

/**
 * 픽셀 사무실 화면. 칸 크기에 맞춰 정수 배율로 키운다(도트가 번지지 않게).
 * 이름표·캐릭터를 누르면 그 세션으로 간다. deliver = 지금 시각의 배달 연출(없으면 null) — 프레임마다 부른다
 */
/** bossIn = 반장 반응 재료(참모 상태·마지막 답·음성 모드·코인 들어온 때) — 프레임마다 bossReaction 으로 계산한다 */
export type BossIn = { status: ActivityStatus; reply: { text: string; ts: number } | null; voice: boolean; cheerAt: number | null };

/** 'width' = 칸 폭에 꽉(소수 배율), 'box' = 칸 폭·높이 둘 다에 맞춰(소수 배율 — 폰 사무실, 반 시트가 열려 칸이 낮아지면 방이 준다), 'int' = 정수 배율(도트가 안 번지게, 데스크톱) */
export type Fit = 'int' | 'width' | 'box';
export function fitScale(fit: Fit, cw: number, ch: number, W: number, H: number, bottom: number): number {
  if (fit === 'width') return cw / W;
  if (fit === 'box') return Math.max(0.1, Math.min(cw / W, ch / H));
  return Math.max(1, Math.floor(Math.min((cw - 24) / W, (ch - 24 - bottom) / H)));
}

export function OfficeView({ room, roomId = 0, overlay, skin, menu, bottom = 0, deliver, onOpen, coins, gain, onGacha, bossIn, deco, peek, dim, fit = 'int', picked, tags = 'all', dot }: { /** 작은 점을 달 책상 — 이 사무실을 연 참모가 캐릭터를 안 정했을 때(누르면 고르기 창) */ dot?: string | null; room: Room; /** 사무실 번호 — 넘기면 출근 연출을 처음부터 안 한다 */ roomId?: number; /** 넓어질 자리 등 바닥 위 덧칠 */ overlay?: (b: Brush, P: (x: number, y: number, z?: number) => [number, number]) => void; /** 'few' = 폰 방 — 사람 필요·물어봄·고른 것만 이름표, 겹치면 비키거나 +N, 하는 일 한 줄 없음(ui/office/tags) */ tags?: 'all' | 'few'; skin?: string; /** 배율 — Fit 참고 */ fit?: Fit; /** 고른 세션 — 그 캐릭터에 고리(폰: 누르면 고르고 아래 카드로 대화) */ picked?: string | null; /** 이름표를 옅게 할 세션(채팅 뷰: 지금 채팅 탭 참모가 시킨 것만 진하게) */ dim?: (id: string) => boolean; /** 아래에 덮이는 높이(가구 트레이) — 방을 그만큼 위로 올려 가리지 않게 */ bottom?: number; /** 왼쪽 위 메뉴 */ menu?: ReactNode; /** 이름표에 마우스를 올리면 띄울 미니 터미널(읽기 전용, 머리줄에 지금 하는 일). null 이면 안 띄움 */ peek?: (id: string, doing?: string) => ReactNode; deliver?: (now: number) => Delivery | null; onOpen: (id: string) => void; /** 가챠 코인(오른쪽 위) — 누르면 뽑기 페이지 */ coins?: number; gain?: { n: number; at: number } | null; onGacha?: () => void; bossIn?: BossIn; /** 뽑기로 얻어 장착한 것 — 모자·창밖·펑 대신·춤. cat·coffee 는 펫 친구·커피 액션 */ deco?: Deco & { hasCat?: boolean; coffee?: boolean; /** 반장 이름표 앞 칭호(뽑기) */ title?: string; /** 고양이 말고 가진 펫 친구 id(팩) — 고양이와 시차를 두고 같은 길을 걷는다 */ palIds?: string[] } }) {
  const wrap = useRef<HTMLDivElement>(null);
  const cv = useRef<HTMLCanvasElement>(null);
  const [scale, setScale] = useState(3);
  const [spots, setSpots] = useState<Spot[]>([]);
  const [react, setReact] = useState<BossReact | null>(null);
  const sk = skinOf(skin);
  // 미니 터미널 — 한 번에 하나. 올리고 0.35초 뒤 뜨고, 이름표·창에서 벗어나고 0.25초 뒤 닫힌다(창으로 옮겨 가는 사이 안 꺼지게)
  const [peekId, setPeekId] = useState<string | null>(null);
  const peekTimer = useRef<number>(0);
  const peekOn = (id: string) => { window.clearTimeout(peekTimer.current); peekTimer.current = window.setTimeout(() => setPeekId(id), 350); };
  const peekOff = () => { window.clearTimeout(peekTimer.current); peekTimer.current = window.setTimeout(() => setPeekId(null), 250); };
  const { W, H } = roomSize(room);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const size = () => setScale(fitScale(fit, el.clientWidth, el.clientHeight, W, H, bottom));
    size();
    const ro = new ResizeObserver(size);
    ro.observe(el);
    return () => ro.disconnect();
  }, [W, H, bottom, fit]);

  // 그리는 데 필요한 건 ref 로 — 세션 목록이 3초마다 바뀌어도 타이머를 다시 만들지 않는다
  const latest = useRef({ room, roomId, sk, deliver, bossIn, deco, overlay });
  latest.current = { room, roomId, sk, deliver, bossIn, deco, overlay };
  useEffect(() => {
    const c = cv.current;
    const ctx = c?.getContext('2d');
    if (!c || !ctx) return;
    let t = 0;
    let lastKey = '';
    let lastReact = '';
    // 출근·퇴근: 책상 주인이 바뀌는 순간을 잡는다 — 새로 앉으면 문에서 걸어 들어오고, 나가면 펑. 첫 프레임·사무실을 넘긴 직후는 원래 있던 거라 안 한다
    let seen: Map<string, [number, number]> | null = null;
    let poofs: (Poof & { t0: number })[] = [];
    let coming: { id: string; t0: number }[] = [];
    let lastRoom = latest.current.roomId;
    let drawn = false;
    const frame = () => {
      // 사람이 안 보면(ui/attention — 다른 앱이 앞·입력 2분 없음·덮개) 그리지 않는다. 첫 장은 그린다(빈 캔버스로 두지 않게)
      if (drawn && !isAttended()) return;
      drawn = true;
      const { room: r, roomId: ri, sk: s, deliver: dv, bossIn: bi, deco: dc, overlay: ov } = latest.current;
      const { W: w0, H: h0 } = roomSize(r);
      if (c.width !== w0 || c.height !== h0) { c.width = w0; c.height = h0; }
      const now = Date.now();
      if (ri !== lastRoom) { lastRoom = ri; seen = null; poofs = []; coming = []; }
      const cur = new Map(r.desks.filter((d) => !d.empty && !d.stand).map((d) => [d.id, [d.gx + d.w / 2, d.gy + 0.35] as [number, number]]));
      if (seen) {
        for (const id of cur.keys()) if (!seen.has(id)) coming.push({ id, t0: now });
        for (const [id, at] of seen) if (!cur.has(id)) poofs.push({ id: '', gx: at[0], gy: at[1], age: 0, t0: now });
      }
      seen = cur;
      poofs = poofs.filter((p) => now - p.t0 < POOF_MS).map((p) => ({ ...p, age: now - p.t0 }));
      coming = coming.filter((a) => now - a.t0 < ARRIVE_MS);
      const arrivals = coming.flatMap((a) => { const w = arrival(r, a.id, now - a.t0); return w ? [w] : []; });
      const br = bi ? bossReaction({ ...bi, now }) : null;
      const rk = br ? `${br.mode}:${br.text ?? ''}` : '';
      if (rk !== lastReact) { lastReact = rk; setReact(br); }
      // 배달이 없고 반장이 한가하면 커피 액션(장착했을 때)
      const walker = dv?.(now) ?? (dc?.coffee && !br ? coffeeWalk(r, now) : null);
      const sp = drawRoom(ctx, r, s, t++, { walker, arrivals, poofs, boss: br, deco: { ...dc, cat: dc?.hasCat ? catWalk(r, now) : null, pals: dc?.palIds?.map((id, k) => ({ id, ...catWalk(r, now + (k + 1) * 6_000) })) }, ...(ov ? { edit: { under: ov } } : {}) });
      // 이름표는 자리가 바뀔 때만 다시 그린다(매 프레임 setState 하면 화면 전체가 다시 그려진다)
      const key = sp.map((x) => `${x.id}:${x.x}:${x.y}:${x.st}:${x.label}:${x.doing ?? ''}:${x.human ?? '-'}`).join('|');
      // 하는 일 한 줄은 이름표에 안 띄운다 — 2.5초씩 이름표가 길어져 이웃을 덮었다(11-09). 현황판·미니 터미널 머리줄이 늘 보여 준다
      if (key !== lastKey) { lastKey = key; setSpots(sp); }
    };
    frame();
    const id = setInterval(frame, FRAME_MS);
    return () => clearInterval(id);
  }, []);

  const click = (e: React.MouseEvent) => {
    const r = cv.current?.getBoundingClientRect();
    if (!r) return;
    const x = (e.clientX - r.left) / scale, y = (e.clientY - r.top) / scale;
    let best: Spot | null = null, bd = 14 * 14;
    for (const s of spots) { const d = (s.hx - x) ** 2 + (s.hy - y) ** 2; if (d < bd) { bd = d; best = s; } }
    if (best) onOpen(best.id);
  };

  return (
    <div className="office" ref={wrap} style={{ background: sk.bg, paddingBottom: bottom }}>
      {onGacha && (
        <button className={`office-coin ${gain && Date.now() - gain.at < 4000 ? 'gain' : ''}`} onClick={onGacha} aria-label={tr(`뽑기 — 코인 ${(coins ?? 0).toLocaleString()}`, `Gacha — ${(coins ?? 0).toLocaleString()} coins`)} title={tr('뽑기 — 머지·시킨 일·커밋으로 코인이 쌓인다', 'Gacha — merges, finished tasks and commits earn coins')}>
          <i />{(coins ?? 0).toLocaleString()}
          {gain && Date.now() - gain.at < 4000 && <em>+{gain.n}</em>}
        </button>
      )}
      {menu && <div className="office-menu-slot">{menu}</div>}
      <div className="office-room" style={{ width: W * scale, height: H * scale }}>
        <canvas ref={cv} className="office-cv" style={{ width: W * scale, height: H * scale }} onClick={click} />
        {react?.text && (() => {
          const bs = spots.find((s) => room.desks.some((d) => d.boss && d.id === s.id));
          return bs ? <div className={`office-say ${react.mode}`} style={{ left: bs.hx * scale, top: (bs.hy - 22) * scale }}>{react.text}</div> : null;
        })()}
        {/* 고리는 이름표보다 먼저 — 옆 이름표 글을 고리 선이 긋지 않게(시험 17개) */}
        {picked && (() => {
          const s = spots.find((x) => x.id === picked);
          return s ? <span className="office-ring" style={{ left: s.hx * scale, top: s.hy * scale }} /> : null;
        })()}
        {tags === 'few' && fewTags(spots.filter((x) => !x.off), picked, scale, W * scale).map((t) => {
          const s = spots.find((x) => x.id === t.id)!;
          return (
            <button key={s.id} className={`office-tag ${sk.label} ${s.human !== undefined ? 'human' : s.st === 'asks' ? 'hot' : ''}`} style={{ left: t.cx, top: t.top }}
              aria-label={t.more ? `${s.label} 외 ${t.more}` : s.label} onClick={() => onOpen(s.id)}>
              {s.label}{t.more > 0 && <span className="office-more">+{t.more}</span>}
            </button>
          );
        })}
        {tags === 'all' && (() => {
          // 이름표는 서로 안 겹치게 비키고, 자리가 없으면 +N(ui/office/tags allTags) — 반장 칭호도 폭에 넣는다
          const bossId = room.desks.find((d) => d.boss)?.id;
          const title = deco?.title ? titleText(deco.title) : '';
          const sized = spots.map((x) => (title && x.id === bossId ? { ...x, label: `${title} ${x.label}` } : x));
          return allTags(sized, picked, scale, W * scale, dim).map((t) => {
            const s = spots.find((x) => x.id === t.id)!, more = t.more + (s.more ?? 0);
            return (
              <button
                key={s.id}
                className={`office-tag ${sk.label} ${s.off ? 'v-off' : s.human !== undefined ? 'human' : s.st === 'asks' ? 'hot' : ''} ${s.human === undefined && dim?.(s.id) ? 'st-dim' : ''}`}
                style={{ left: t.cx, top: t.top }}
                title={s.off ? tr(`${s.label} — 꺼져 있어 · 눌러서 깨우기`, `${s.label} — off · click to wake`) : s.human !== undefined ? tr(`${s.label} — 사람 필요${s.human ? `: ${s.human}` : ''} · 눌러서 브라우저 열기`, `${s.label} — needs you${s.human ? `: ${s.human}` : ''} · click to open the browser`) : tr(`${s.label} — 눌러서 열기`, `${s.label} — click to open`)}
                aria-label={more ? tr(`${s.label} 외 ${more}`, `${s.label} and ${more} more`) : s.label}
                onClick={() => onOpen(s.id)}
                onMouseEnter={peek && !s.off ? () => peekOn(s.id) : undefined}
                onMouseLeave={peek && !s.off ? peekOff : undefined}
              >
                {title && s.id === bossId && <span className="office-title">{title}</span>}
                {s.label}
                {more > 0 && <span className="office-more">+{more}</span>}
              </button>
            );
          });
        })()}
        {dot && (() => {
          const s = spots.find((x) => x.id === dot);
          return s ? <span className="office-dot" aria-hidden style={{ left: (s.hx + 7) * scale, top: (s.hy - 14) * scale }} /> : null;
        })()}
        {peek && peekId && (() => {
          const s = spots.find((x) => x.id === peekId);
          const body = s ? peek(peekId, s.doing) : null;
          if (!s || !body) return null;
          const below = s.y * scale < (H * scale) / 2;
          return (
            <div className="office-peek" style={{ left: Math.min(Math.max(8, s.x * scale - 230), W * scale - 468), top: below ? s.y * scale + 34 : undefined, bottom: below ? undefined : H * scale - s.y * scale + 8 }}
              onMouseEnter={() => window.clearTimeout(peekTimer.current)} onMouseLeave={peekOff}>
              {body}
            </div>
          );
        })()}
      </div>
    </div>
  );
}
