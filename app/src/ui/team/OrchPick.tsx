// 내 참모 고르기 한 조각 — 팀 보관함 '내 참모에게' 메뉴·입력칸 @ 메뉴 '내 참모'·말풍선 '내 참모에게 넘기기'가 같이 쓴다(10-28 사용자 "글자만 있어서 헷갈린다").
// 어디서든 같은 모양: 참모 프사 + 이름(별명)만 — '일하는 중' 같은 상태 글은 없다. 순서는 마지막 고른 참모가 맨 위(domain/teamGive pickOrder)
import { useState } from 'react';
import { pickOrder, PICK_KEY, type RosterOrch } from '../../domain/teamGive';
import { OrchAvatar } from '../avatar/OrchAvatar';

const readLast = () => { try { return localStorage.getItem(PICK_KEY); } catch { return null; } };

/** 마지막 고른 참모 기억 — 고를 때 remember(id) */
export function rememberPick(id: string) {
  try { localStorage.setItem(PICK_KEY, id); } catch { /* 이번 실행만 순서가 안 바뀐다 */ }
}

/** 고르기 순서대로 — 마지막 고른 참모가 맨 위 */
export function usePickOrder(list: RosterOrch[]): RosterOrch[] {
  const [last] = useState(readLast);
  return pickOrder(list, last);
}

/** 한 줄 안쪽 — 프사 + 이름. 메뉴 단추·목록 단추 안에 그대로 넣는다 */
export function OrchPickRow({ o, size = 22 }: { o: RosterOrch; size?: number }) {
  return (
    <span className="tmx-opk">
      <OrchAvatar name={o.name || o.label} size={size} state="rest" color={o.color || '#8a8f98'} label={o.label} />
      <b>{o.label}</b>
    </span>
  );
}

/** 고르기 목록 — 누르면 그 참모(기억도 같이) */
export function OrchPickList({ list, onPick, label }: { list: RosterOrch[]; onPick: (o: RosterOrch) => void; label: string }) {
  const ordered = usePickOrder(list);
  return (
    <div className="tmx-opk-list" role="listbox" aria-label={label}>
      {ordered.map((o) => (
        <button key={o.id} role="option" aria-selected={false} className="tmx-opk-btn" onClick={() => { rememberPick(o.id); onPick(o); }}>
          <OrchPickRow o={o} size={26} />
        </button>
      ))}
    </div>
  );
}
