import { useEffect, useRef, useState } from 'react';
import { ago, dockFit, dockLine, pushTick, type Tick } from '../../domain/dock';
import { dockOrder, type Desk } from '../../domain/office';
import { scaled } from '../gacha/icons';
import { brush, pet } from './draw';
import type { Skin } from './skins';
import { tr } from '../../i18n';
import { IconChevronDown } from '../Icons';

/** 현황판 얼굴 — 사무실과 같은 도트·같은 색. 16칸 도트를 2배로 */
export function Face({ spr, fill, sk }: { spr: string; fill: string; sk: Skin }) {
  const cv = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const ctx = cv.current?.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, 64, 64);
    // 26칸 안에 담아 두 배 — 새 캐릭터(최대 25칸)도 머리가 안 잘린다, 16칸 다마고치 도트는 가운데에
    pet(scaled(brush(ctx), 6, 6, 2), sk, spr, 5, 9, fill);
  }, [spr, fill, sk]);
  return <canvas ref={cv} width={64} height={64} className="dock-face" style={{ background: sk.bg }} />;
}

/**
 * 사무실 현황판(방 위에 뜬 말풍선 카드) — 세션마다 얼굴·프로젝트·지금 하는 일, 그 아래 방금 한 일 두 줄.
 * 사무실 머리 위 글씨는 화면을 가려서 2.5초만 띄우는데, 여기는 늘 보인다(사용자 2026-09-27).
 * notes = 일 안 할 때 보일 한 줄(물어본 질문·마지막 답)
 */
export function OfficeDock({ desks, sk, notes = {}, onOpen, dim, onHeight }: { desks: Desk[]; sk: Skin; notes?: Record<string, string>; onOpen: (id: string) => void;
  /** 옅게 할 세션(채팅 뷰: 지금 탭 참모가 안 시킨 것) — 이름표와 같은 기준, 뒤로 보낸다. 사람 필요는 늘 맨 앞·진하게 */ dim?: (id: string) => boolean;
  /** 접힌(한 줄) 현황판 높이 — 방을 그만큼 위로 올려 바닥을 안 가리게. 편 동안은 안 바뀐다(누른 사람이 편 거라 방은 그대로) */ onHeight?: (h: number) => void }) {
  const [ticks, setTicks] = useState<Record<string, Tick[]>>({});
  const [now, setNow] = useState(Date.now());
  const key = desks.map((d) => `${d.id}:${d.doing ?? ''}`).join('|');
  useEffect(() => {
    const t = Date.now();
    setTicks((prev) => {
      const next: Record<string, Tick[]> = {};
      for (const d of desks) next[d.id] = pushTick(prev[d.id] ?? [], d.st === 'working' ? d.doing ?? '' : '', t);
      return next;
    });
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(id);
  }, []);

  // 한 줄만 — 넘치면 +N(domain/dock dockFit). 줄이 늘면 방 바닥을 가렸다(11-09 사용자 13장 = 세 줄)
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => { setWidth(el.clientWidth); if (!el.classList.contains('open')) onHeight?.(el.offsetHeight); });
    ro.observe(el);
    return () => ro.disconnect();
  }, [desks.length > 0]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => onHeight?.(0), []); // eslint-disable-line react-hooks/exhaustive-deps
  if (!desks.length) return null;
  const ordered = dockOrder(desks, dim);
  const fit = width ? dockFit(ordered.length, width) : { show: ordered.length, more: 0 };
  const shown = open || !fit.more ? ordered : ordered.slice(0, fit.show);
  return (
    <div ref={box} className={`office-dock ${open ? 'open' : ''}`}>
      {shown.map((d) => {
        const human = d.human !== undefined;
        const line = dockLine(d.status ?? 'idle', d.act, d.doing, d.human);
        const [cur, ...old] = ticks[d.id] ?? [];
        const live = d.st === 'working' && !human;
        return (
          <button key={d.id} className={`dock-card st-${human ? 'human' : d.st} ${!human && dim?.(d.id) ? 'st-dim' : ''}`} onClick={() => onOpen(d.id)}
            title={human ? tr('눌러서 브라우저 열기', 'Click to open the browser') : tr('눌러서 이 세션 열기', 'Click to open this session')}>
            <Face spr={d.spr} fill={sk.pets[d.color % sk.pets.length]!} sk={sk} />
            <span className="dock-main">
              <span className="dock-head">
                <b>{d.label}</b>
                <span className="dock-verb">{line.verb}</span>
                {live && cur && <span className="dock-ago">{ago(cur.at, now)}</span>}
              </span>
              <span className={live ? 'dock-now' : 'dock-note'}>{live ? line.text || '…' : human ? line.text : notes[d.id] ?? ''}</span>
              {live && old.map((x, i) => <span key={i} className="dock-old">{x.text}</span>)}
            </span>
          </button>
        );
      })}
      {fit.more > 0 && (
        <button type="button" className="dock-more" aria-expanded={open} onClick={() => setOpen((v) => !v)}
          aria-label={open ? tr('현황판 접기', 'Fold the board') : tr(`세션 ${fit.more}개 더 보기`, `Show ${fit.more} more`)} title={open ? tr('접기', 'Fold') : tr(`${fit.more}개 더`, `${fit.more} more`)}>
          {open ? <IconChevronDown /> : `+${fit.more}`}
        </button>
      )}
    </div>
  );
}
