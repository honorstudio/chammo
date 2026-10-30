// 팀 홈 캘린더 블록(사용자 10-30 결정 ①) — 반 폭 = 다가오는 일정 목록, 전체 폭 = 이번 주 7칸 띠. 머리 아이콘 = 캘린더 탭 열기
import { tr } from '../../i18n';
import { desktopCal, type CalApi } from '../../data/teamCalApi';
import { addDays, byDay, occurrences, upcoming, weekDays, ymd } from '../../domain/teamCal';
import { IconButton } from '../kit/IconButton';
import { IconOpen, IconRepeat } from '../Icons';
import { useTeamCal } from './useTeamCal';
import './teamCal.css';

const DOW = () => [tr('일', 'Sun'), tr('월', 'Mon'), tr('화', 'Tue'), tr('수', 'Wed'), tr('목', 'Thu'), tr('금', 'Fri'), tr('토', 'Sat')];
const hm = (ms: number) => new Date(ms).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false });

export function CalBlock({ teamId, wide, editing, onOpen, api = desktopCal }: { teamId: string; wide: boolean; editing: boolean; onOpen?: () => void; api?: CalApi }) {
  const { snap, err } = useTeamCal(teamId, api);
  const today = ymd(new Date());
  const head = (
    <div className="hb-bh">{tr('팀 캘린더', 'Team calendar')}<span className="hb-s2">{wide ? tr('이번 주', 'This week') : tr('다가오는 일정', 'Upcoming')}</span>
      {onOpen && !editing && <span className="tcal-bopen"><IconButton size="s" label={tr('캘린더 열기', 'Open the calendar')} onClick={onOpen}><IconOpen /></IconButton></span>}
    </div>
  );
  if (editing) return head;
  if (!snap) return <>{head}<div className="hb-none">{err ? tr('일정을 못 불러왔어요', "Couldn't load events") : tr('불러오는 중…', 'Loading…')}</div></>;
  if (wide) {
    const days = weekDays(today);
    const cells = byDay(occurrences(snap.items, days[0]!, addDays(days[6]!, 1), { hideDone: true }), days);
    return (
      <>{head}
        <div className="tcal-bweek">
          {days.map((day, i) => {
            const list = cells.get(day) ?? [];
            return (
              <div key={day} className={`tcal-bwd ${day === today ? 'now' : ''}`}>
                <div className="tcal-bwh">{DOW()[i]}<b>{Number(day.slice(8))}</b></div>
                {list.slice(0, 2).map((o) => <div key={o.key} className={`tcal-bwc l-${o.label}`} title={o.title}><span><i />{o.title}</span>{!o.allDay && <em>{hm(o.startMs)}</em>}</div>)}
                {list.length > 2 && <span className="tcal-more">{tr(`+${list.length - 2}개`, `+${list.length - 2}`)}</span>}
              </div>
            );
          })}
        </div>
      </>
    );
  }
  const groups = upcoming(snap.items, today, 14, 7);
  const label = (day: string) => (day === today ? tr('오늘', 'Today') : new Date(day.replace(/-/g, '/')).toLocaleDateString(undefined, { month: 'long', day: 'numeric', weekday: 'short' }));
  return (
    <>{head}
      {groups.length ? (
        <div className="tcal-up">
          {groups.map((g) => (
            <div key={g.day}>
              <div className="tcal-uph">{label(g.day)}</div>
              {g.occ.map((o) => (
                <div key={o.key} className="tcal-upr"><span className="tcal-lt">{o.allDay ? tr('종일', 'All day') : hm(o.startMs)}</span><span className={`tcal-lx l-${o.label}`}><i /><span>{o.title}</span>{o.repeat && <IconRepeat />}</span></div>
              ))}
            </div>
          ))}
        </div>
      ) : <div className="hb-none">{tr('2주 안에 일정이 없어요', 'Nothing in the next two weeks')}</div>}
    </>
  );
}
