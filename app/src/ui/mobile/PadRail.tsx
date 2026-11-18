// 패드 띠(11-18 시안 v1 A — 맥 접힌 참모 띠 56 을 손가락 68 로). 참모 얼굴 줄은 참모 바꾸기 시트와 같은 순서(고정 → 맥에서 끌어 둔 순서, orchSort)·
// 같은 상태 점(대화 꼬리, orchDot)·같은 컨텍스트 고리(AvatarRing). 누르면 그 참모, 길게 누르면 그 참모 메뉴(시트 메뉴 그대로 — onMenu),
// + = 참모 바꾸기 시트(새 참모·꺼진 참모 깨우기), 아래 = 팀·메모(폰 아래 탭바 자리 — 맥처럼 띠 아래). 익숙한 동작이라 아이콘 + aria-label
import { readOrder, readPins } from '../../data/web';
import { subStatus, type Waiting } from '../../domain/mobile';
import { orchDot } from '../../domain/orchDot';
import { orchSort } from '../../domain/orchOrder';
import { parsePins } from '../../domain/orchPins';
import type { Ctx } from '../../domain/ctx';
import type { Session } from '../../domain/session';
import { tr } from '../../i18n';
import { bodyColor, orchColor, useAvatars } from '../avatar';
import { IconNotebook, IconPeople, IconPlus } from '../Icons';
import { AvatarRing } from './kit';
import { MAvatar } from './MAvatar';
import { usePendingNicks } from './pendingNicks';
import { usePress } from './PhoneLockerParts';
import { useMemoPoll } from './usePoll';
import { useSubTails } from './useSubTails';

/** 띠·⌘1~9 의 참모 순서 — 시트와 같은 기억 칸(pins·order)이라 따로 안 받는다 */
export function useSortedOrchs(orchs: Session[]): Session[] {
  const [pinsText] = useMemoPoll('pins', readPins, 5000, '[]');
  const [orderText] = useMemoPoll('order', readOrder, 5000, '[]');
  return orchSort(orchs, parsePins(orderText), parsePins(pinsText), (s) => s.sessionId);
}

type Tab = 'orch' | 'team' | 'notes';

function Face({ s, orchs, cur, asking, used, dot, onPick, onMenu }: { s: Session; orchs: Session[]; cur: boolean; asking: boolean; used?: number; dot: ReturnType<typeof orchDot>; onPick: () => void; onMenu: () => void }) {
  const { saved } = useAvatars();
  const color = bodyColor(saved, s.name, orchColor(s.name));
  const name = usePendingNicks(orchs).nameOf(s);
  const press = usePress(onPick, onMenu);
  return (
    <button type="button" className={`m-tb-face${cur ? ' m-cur' : ''}`} style={{ '--fc': color } as React.CSSProperties} {...press}
      aria-current={cur || undefined} aria-label={`${name} — ${dot.label}${used !== undefined ? tr(`, 컨텍스트 ${Math.round(used)}%`, `, context ${Math.round(used)}%`) : ''}`} title={name}>
      <AvatarRing pct={used} dot={dot.cls} dotLabel={dot.label} color={color} size={44}><MAvatar orch={s} orchs={orchs} size={32} asking={asking} /></AvatarRing>
    </button>
  );
}

export function PadRail({ orchs, current, waiting, ctx, tab, teamUnread, onPick, onMenu, onPicker, onTab }: {
  /** useSortedOrchs 로 줄 세운 켜진 참모 */ orchs: Session[]; current: string; waiting: Waiting[]; ctx: Record<string, Ctx>; tab: Tab; teamUnread: number;
  onPick: (id: string) => void; onMenu: (id: string) => void; onPicker: () => void; onTab: (t: Exclude<Tab, 'orch'>) => void;
}) {
  const tails = useSubTails(orchs);
  const now = Date.now();
  return (
    <nav className="m-tb-rail" aria-label={tr('참모', 'Assistants')}>
      <div className="m-tb-faces">
      {orchs.map((s) => {
        const asking = waiting.some((w) => w.orch === s.id);
        return <Face key={s.id} s={s} orchs={orchs} cur={tab === 'orch' && s.id === current} asking={asking} used={s.sessionId ? ctx[s.sessionId]?.used : undefined}
          dot={orchDot(subStatus(s, tails, now), asking)} onPick={() => onPick(s.id)} onMenu={() => onMenu(s.id)} />;
      })}
      <button type="button" className="m-tb-ib m-tb-new" onClick={onPicker} aria-label={tr('참모 바꾸기·깨우기·새로', 'Switch, wake or add an assistant')} title={tr('참모', 'Assistants')}><IconPlus /></button>
      </div>
      <button type="button" className={`m-tb-ib${tab === 'team' ? ' m-on' : ''}`} onClick={() => onTab('team')} aria-pressed={tab === 'team'} aria-label={tr('팀', 'Team')} title={tr('팀', 'Team')}>
        <IconPeople />{teamUnread > 0 && <i className="tmx-ur in">{teamUnread > 99 ? '99+' : teamUnread}</i>}
      </button>
      <button type="button" className={`m-tb-ib${tab === 'notes' ? ' m-on' : ''}`} onClick={() => onTab('notes')} aria-pressed={tab === 'notes'} aria-label={tr('내 메모', 'My notes')} title={tr('내 메모', 'My notes')}><IconNotebook /></button>
    </nav>
  );
}
