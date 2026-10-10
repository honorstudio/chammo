import { useEffect, useRef, useState, type ReactNode } from 'react';
import { bossReaction, catWalk, cellAt, coffeeWalk, furnitureAt, type BossReact, type Delivery, type Room } from '../../domain/office';
import { ItemIcon } from '../gacha/GachaPage';
import { titleText } from '../gacha/icons';
import type { ActivityStatus } from '../../domain/status';
import { drawRoom, POOF_MS, roomSize, type Deco, type Poof, type Spot } from './draw';
import { skinOf } from './skins';
import { tr } from '../../i18n';
import { isAttended } from '../attention';

const FRAME_MS = 120; // 도트 느낌 — 초당 8장쯤(펑이 너무 뚝뚝 끊기지 않게)

/**
 * 픽셀 사무실 화면. 칸 크기에 맞춰 정수 배율로 키운다(도트가 번지지 않게).
 * 이름표·캐릭터를 누르면 그 세션으로 간다. deliver = 지금 시각의 배달 연출(없으면 null) — 프레임마다 부른다
 */
/** bossIn = 반장 반응 재료(참모 상태·마지막 답·음성 모드·코인 들어온 때) — 프레임마다 bossReaction 으로 계산한다 */
export type BossIn = { status: ActivityStatus; reply: { text: string; ts: number } | null; voice: boolean; cheerAt: number | null };

/**
 * edit = 가구 놓기(심즈처럼) — 아래 트레이나 방에 놓인 가구를 끌어서 옮긴다. 끄는 동안 그 자리에 반투명 미리보기,
 * 칸은 놓을 수 있으면 초록·없으면 빨강. drag = 지금 끄는 가구 id(App 이 들고 있다 — 트레이에서도 집으니까).
 * onPick = 방에 놓인 가구를 집음, onDrop = 놓음(cell = 방 위 칸, 방 밖이면 null — 트레이 위면 창고는 App 이 판단)
 */
export type EditMode = { drag: string | null; ok: (cell: [number, number]) => boolean; onPick: (id: string) => void; onDrop: (cell: [number, number] | null, e: PointerEvent) => void };

export function OfficeView({ room, skin, menu, bottom = 0, edit, deliver, onOpen, coins, gain, onGacha, bossIn, deco, peek, dim }: { room: Room; skin?: string; /** 이름표를 옅게 할 세션(채팅 뷰: 지금 채팅 탭 참모가 시킨 것만 진하게) */ dim?: (id: string) => boolean; /** 아래에 덮이는 높이(가구 트레이) — 방을 그만큼 위로 올려 가리지 않게 */ bottom?: number; /** 왼쪽 위 메뉴 */ menu?: ReactNode; /** 이름표에 마우스를 올리면 띄울 미니 터미널(읽기 전용, 머리줄에 지금 하는 일). null 이면 안 띄움 */ peek?: (id: string, doing?: string) => ReactNode; edit?: EditMode; deliver?: (now: number) => Delivery | null; onOpen: (id: string) => void; /** 가챠 코인(오른쪽 위) — 누르면 뽑기 페이지 */ coins?: number; gain?: { n: number; at: number } | null; onGacha?: () => void; bossIn?: BossIn; /** 뽑기로 얻어 장착한 것 — 모자·창밖·펑 대신·춤. cat·coffee 는 펫 친구·커피 액션 */ deco?: Deco & { hasCat?: boolean; coffee?: boolean; /** 반장 이름표 앞 칭호(뽑기) */ title?: string } }) {
  const wrap = useRef<HTMLDivElement>(null);
  const cv = useRef<HTMLCanvasElement>(null);
  const [scale, setScale] = useState(3);
  const [spots, setSpots] = useState<Spot[]>([]);
  // 하는 일은 늘 띄우면 화면을 가린다 — 도구가 바뀐 순간 2.5초만(사용자 2026-09-27)
  const [flash, setFlash] = useState<Record<string, string>>({});
  const lastDoing = useRef<Record<string, string>>({});
  const [react, setReact] = useState<BossReact | null>(null);
  const sk = skinOf(skin);
  const [hover, setHover] = useState<[number, number] | null>(null);
  // 미니 터미널 — 한 번에 하나. 올리고 0.35초 뒤 뜨고, 이름표·창에서 벗어나고 0.25초 뒤 닫힌다(창으로 옮겨 가는 사이 안 꺼지게)
  const [peekId, setPeekId] = useState<string | null>(null);
  const peekTimer = useRef<number>(0);
  const peekOn = (id: string) => { window.clearTimeout(peekTimer.current); peekTimer.current = window.setTimeout(() => setPeekId(id), 350); };
  const peekOff = () => { window.clearTimeout(peekTimer.current); peekTimer.current = window.setTimeout(() => setPeekId(null), 250); };
  const { W, H } = roomSize(room);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const fit = () => setScale(Math.max(1, Math.floor(Math.min((el.clientWidth - 24) / W, (el.clientHeight - 24 - bottom) / H))));
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [W, H, bottom]);

  // 그리는 데 필요한 건 ref 로 — 세션 목록이 3초마다 바뀌어도 타이머를 다시 만들지 않는다
  const latest = useRef({ room, sk, deliver, bossIn, deco, edit, hover });
  latest.current = { room, sk, deliver, bossIn, deco, edit, hover };
  // 끄는 중엔 창 전체에서 포인터를 따라간다(트레이 → 방으로 건너올 때도). 방 밖이면 커서 옆에 작은 아이콘
  const [float, setFloat] = useState<[number, number] | null>(null);
  const dragging = edit?.drag ?? null;
  useEffect(() => {
    if (!dragging) { setFloat(null); return; }
    const at = (e: PointerEvent): [number, number] | null => {
      const r = cv.current?.getBoundingClientRect();
      if (!r) return null;
      const { room: rm } = latest.current;
      const { ox, oy } = roomSize(rm);
      const sc = r.width / roomSize(rm).W;
      return cellAt(rm, ox, oy, (e.clientX - r.left) / sc, (e.clientY - r.top) / sc);
    };
    const move = (e: PointerEvent) => { const c = at(e); setHover((h) => (h?.[0] === c?.[0] && h?.[1] === c?.[1] ? h : c)); setFloat(c ? null : [e.clientX, e.clientY]); };
    const up = (e: PointerEvent) => { latest.current.edit?.onDrop(at(e), e); setHover(null); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    document.body.classList.add('furn-dragging');
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); document.body.classList.remove('furn-dragging'); };
  }, [dragging]);
  useEffect(() => {
    const c = cv.current;
    const ctx = c?.getContext('2d');
    if (!c || !ctx) return;
    let t = 0;
    let lastKey = '';
    let lastReact = '';
    // 펑: 책상 주인이 바뀌는 순간(새로 앉음·나감)을 잡는다. 첫 프레임은 원래 있던 거라 안 터뜨린다
    let seen: Map<string, [number, number]> | null = null;
    let poofs: (Poof & { t0: number })[] = [];
    let drawn = false;
    const frame = () => {
      // 사람이 안 보면(ui/attention — 다른 앱이 앞·입력 2분 없음·덮개) 그리지 않는다. 첫 장은 그린다(빈 캔버스로 두지 않게)
      if (drawn && !isAttended()) return;
      drawn = true;
      const { room: r, sk: s, deliver: dv, bossIn: bi, deco: dc, edit: ed, hover: hv } = latest.current;
      const { W: w0, H: h0 } = roomSize(r);
      if (c.width !== w0 || c.height !== h0) { c.width = w0; c.height = h0; }
      const now = Date.now();
      const cur = new Map(r.desks.filter((d) => !d.empty && !d.boss).map((d) => [d.id, [d.gx + d.w / 2, d.gy + 0.35] as [number, number]]));
      if (seen) {
        for (const [id, at] of cur) if (!seen.has(id)) poofs.push({ id, gx: at[0], gy: at[1], age: 0, t0: now });
        for (const [id, at] of seen) if (!cur.has(id)) poofs.push({ id: '', gx: at[0], gy: at[1], age: 0, t0: now });
      }
      seen = cur;
      poofs = poofs.filter((p) => now - p.t0 < POOF_MS).map((p) => ({ ...p, age: now - p.t0 }));
      const br = bi ? bossReaction({ ...bi, now }) : null;
      const rk = br ? `${br.mode}:${br.text ?? ''}` : '';
      if (rk !== lastReact) { lastReact = rk; setReact(br); }
      // 배달이 없고 반장이 한가하면 커피 액션(장착했을 때)
      const walker = dv?.(now) ?? (dc?.coffee && !br ? coffeeWalk(r, now) : null);
      const sp = drawRoom(ctx, r, s, t++, { walker, poofs, boss: br, deco: { ...dc, cat: dc?.hasCat ? catWalk(r, now) : null }, edit: ed ? { hover: hv, ok: hv ? ed.ok(hv) : false, ghost: ed.drag } : undefined });
      // 이름표는 자리가 바뀔 때만 다시 그린다(매 프레임 setState 하면 화면 전체가 다시 그려진다)
      const key = sp.map((x) => `${x.id}:${x.x}:${x.y}:${x.st}:${x.label}:${x.doing ?? ''}:${x.human ?? '-'}`).join('|');
      if (key !== lastKey) {
        lastKey = key; setSpots(sp);
        for (const x of sp) {
          if (x.doing && x.doing !== lastDoing.current[x.id]) {
            const text = x.doing;
            setFlash((f) => ({ ...f, [x.id]: text }));
            window.setTimeout(() => setFlash((f) => { if (f[x.id] !== text) return f; const n = { ...f }; delete n[x.id]; return n; }), 2500);
          }
          lastDoing.current[x.id] = x.doing ?? '';
        }
      }
    };
    frame();
    const id = setInterval(frame, FRAME_MS);
    return () => clearInterval(id);
  }, []);

  const [grab, setGrab] = useState(false);
  const furnAt = (e: React.MouseEvent) => {
    const r = cv.current?.getBoundingClientRect();
    if (!r) return null;
    const { ox, oy } = roomSize(room);
    return furnitureAt(room, ox, oy, (e.clientX - r.left) / scale, (e.clientY - r.top) / scale);
  };
  const click = (e: React.MouseEvent) => {
    if (edit) return;
    const r = cv.current?.getBoundingClientRect();
    if (!r) return;
    const x = (e.clientX - r.left) / scale, y = (e.clientY - r.top) / scale;
    let best: Spot | null = null, bd = 14 * 14;
    for (const s of spots) { const d = (s.hx - x) ** 2 + (s.hy - y) ** 2; if (d < bd) { bd = d; best = s; } }
    if (best) onOpen(best.id);
  };

  return (
    <div className={`office ${edit ? 'editing' : ''}`} ref={wrap} style={{ background: sk.bg, paddingBottom: bottom }}>
      {onGacha && (
        <button className={`office-coin ${gain && Date.now() - gain.at < 4000 ? 'gain' : ''}`} onClick={onGacha} aria-label={tr(`뽑기 — 코인 ${(coins ?? 0).toLocaleString()}`, `Gacha — ${(coins ?? 0).toLocaleString()} coins`)} title={tr('뽑기 — 머지·시킨 일·커밋으로 코인이 쌓인다', 'Gacha — merges, finished tasks and commits earn coins')}>
          <i />{(coins ?? 0).toLocaleString()}
          {gain && Date.now() - gain.at < 4000 && <em>+{gain.n}</em>}
        </button>
      )}
      {menu && <div className="office-menu-slot">{menu}</div>}
      {dragging && float && <div className="furn-float" style={{ left: float[0], top: float[1] }}><ItemIcon id={dragging} big /></div>}
      <div className="office-room" style={{ width: W * scale, height: H * scale }}>
        <canvas ref={cv} className="office-cv" style={{ width: W * scale, height: H * scale }} onClick={click}
          onPointerDown={edit ? (e) => { const id = furnAt(e); if (id) { e.preventDefault(); edit.onPick(id); } } : undefined}
          onMouseMove={edit && !edit.drag ? (e) => setGrab(!!furnAt(e)) : undefined} onMouseLeave={() => { if (!edit?.drag) setHover(null); setGrab(false); }}
          data-grab={edit && (grab || edit.drag) ? (edit.drag ? 'on' : 'can') : undefined} />
        {react?.text && (() => {
          const bs = spots.find((s) => room.desks.some((d) => d.boss && d.id === s.id));
          return bs ? <div className={`office-say ${react.mode}`} style={{ left: bs.hx * scale, top: (bs.hy - 22) * scale }}>{react.text}</div> : null;
        })()}
        {spots.map((s) => (
          <button
            key={s.id}
            className={`office-tag ${sk.label} ${s.human !== undefined ? 'human' : s.st === 'asks' ? 'hot' : ''} ${s.human === undefined && dim?.(s.id) ? 'st-dim' : ''}`}
            style={{ left: s.x * scale, top: s.y * scale }}
            title={s.human !== undefined ? tr(`${s.label} — 사람 필요${s.human ? `: ${s.human}` : ''} · 눌러서 브라우저 열기`, `${s.label} — needs you${s.human ? `: ${s.human}` : ''} · click to open the browser`) : tr(`${s.label} — 눌러서 그 세션으로`, `${s.label} — click to open the session`)}
            onClick={() => onOpen(s.id)}
            onMouseEnter={peek && !edit ? () => peekOn(s.id) : undefined}
            onMouseLeave={peek && !edit ? peekOff : undefined}
          >
            {deco?.title && room.desks.some((d) => d.boss && d.id === s.id) && <span className="office-title">{titleText(deco.title)}</span>}
            {s.label}
            {flash[s.id] && <span className="office-doing">{flash[s.id]}</span>}
          </button>
        ))}
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
