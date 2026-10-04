import { useEffect, useRef, useState } from 'react';
import { ago, dockLine, pushTick, type Tick } from '../../domain/dock';
import { dockOrder, type Desk } from '../../domain/office';
import { scaled } from '../gacha/icons';
import { brush, pet } from './draw';
import type { Skin } from './skins';
import { tr } from '../../i18n';

/** 현황판 얼굴 — 사무실과 같은 도트·같은 색. 16칸 도트를 2배로 */
function Face({ spr, fill, sk }: { spr: string; fill: string; sk: Skin }) {
  const cv = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const ctx = cv.current?.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, 32, 32);
    pet(scaled(brush(ctx), 0, 0, 2), sk, spr, 0, 0, fill);
  }, [spr, fill, sk]);
  return <canvas ref={cv} width={32} height={32} className="dock-face" style={{ background: sk.bg }} />;
}

/**
 * 사무실 현황판(방 위에 뜬 말풍선 카드) — 세션마다 얼굴·프로젝트·지금 하는 일, 그 아래 방금 한 일 두 줄.
 * 사무실 머리 위 글씨는 화면을 가려서 2.5초만 띄우는데, 여기는 늘 보인다(사용자 2026-09-27).
 * notes = 일 안 할 때 보일 한 줄(물어본 질문·마지막 답)
 */
export function OfficeDock({ desks, sk, notes = {}, onOpen, dim }: { desks: Desk[]; sk: Skin; notes?: Record<string, string>; onOpen: (id: string) => void;
  /** 옅게 할 세션(채팅 뷰: 지금 탭 참모가 안 시킨 것) — 이름표와 같은 기준, 뒤로 보낸다. 사람 필요는 늘 맨 앞·진하게 */ dim?: (id: string) => boolean }) {
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

  if (!desks.length) return null;
  return (
    <div className="office-dock">
      {dockOrder(desks, dim).map((d) => {
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
    </div>
  );
}
