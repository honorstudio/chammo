// 팀 캘린더 탭(chammo-relay ADR 0011, 시안 v2 A) — 월·주·목록, 만들기·고치기·완료·지우기·지운 일정 되살리기. 앱이 직접 그린다(클로드 0)
import { useMemo, useState } from 'react';
import { tr } from '../../i18n';
import { desktopCal, type CalApi } from '../../data/teamCalApi';
import {
  addDays, byDay, lostLine, monthCells, newCalId, occurrences, skipDay, weekDays, withDone, ymd,
  type CalData, type CalItem, type Occ,
} from '../../domain/teamCal';
import { stamp } from '../../domain/teamChat';
import { BetaTag } from '../kit/BetaTag';
import { IconButton } from '../kit/IconButton';
import { IconBack, IconCalendar, IconForward, IconList, IconMore, IconPlus, IconRepeat } from '../Icons';
import { TeamDialog } from './TeamDialog';
import type { HomeDialog } from './TeamHome';
import { CalForm, CalView } from './CalForm';
import { useTeamCal } from './useTeamCal';
import './teamCal.css';

type View = 'month' | 'week' | 'list';
type Person = { id: string; name: string };
type Toast = { text: string; act?: { label: string; run: () => void } };
const DOW = () => [tr('일', 'Sun'), tr('월', 'Mon'), tr('화', 'Tue'), tr('수', 'Wed'), tr('목', 'Thu'), tr('금', 'Fri'), tr('토', 'Sat')];
const HOURS = Array.from({ length: 14 }, (_, i) => i + 7);
const HOUR_PX = 40;
const hidePref = 'chammo.teamCal.hideDone';
const readHide = () => { try { return localStorage.getItem(hidePref) === '1'; } catch { return false; } };

export function TeamCal({ teamId, members, api = desktopCal, phone, Dialog = TeamDialog }: { teamId: string; members: Person[]; api?: CalApi; phone?: boolean; /** 폰은 아래 시트 */ Dialog?: HomeDialog }) {
  const { snap, err, put } = useTeamCal(teamId, api);
  const today = ymd(new Date());
  const [view, setView] = useState<View>(phone ? 'list' : 'month');
  const [anchor, setAnchor] = useState(today);
  const [open, setOpen] = useState<Occ | null>(null);
  const [edit, setEdit] = useState<{ item: CalItem | null; day: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [werr, setWerr] = useState('');
  const [toast, setToast] = useState<Toast | null>(null);
  const [menu, setMenu] = useState(false);
  const [trash, setTrash] = useState(false);
  const [hideDone, setHideDone] = useState(readHide);

  const names = useMemo(() => new Map(members.map((m) => [m.id, m.name])), [members]);
  const nameOf = (id: string) => names.get(id) ?? tr('팀원', 'Teammate');
  const items = snap?.items ?? [];
  const d = new Date(anchor.replace(/-/g, '/'));
  const days = view === 'month' ? monthCells(d.getFullYear(), d.getMonth()) : view === 'week' ? weekDays(anchor) : Array.from({ length: 60 }, (_, i) => addDays(anchor, i));
  const occ = useMemo(() => occurrences(items, days[0]!, addDays(days[days.length - 1]!, 1), { hideDone }), [items, days[0], days.length, hideDone]); // eslint-disable-line react-hooks/exhaustive-deps
  const cells = useMemo(() => byDay(occ, days), [occ]); // eslint-disable-line react-hooks/exhaustive-deps

  const note = (t: Toast) => { setToast(t); window.setTimeout(() => setToast((x) => (x === t ? null : x)), 5000); };
  const write = async (it: CalItem | null, id: string, data: CalData | null, restore = false) => {
    setBusy(true);
    setWerr('');
    try {
      const r = await put(it, id, data, restore);
      if (r.gone) note({ text: tr(`${nameOf(r.by)}님이 지운 일정이에요`, `${nameOf(r.by)} deleted this`), act: data ? { label: tr('다시 살리기', 'Restore'), run: () => void write(it, id, data, true) } : undefined });
      else if (r.lost.length) note({ text: lostLine(r.lost, nameOf(r.by)) });
      return true;
    } catch (e) {
      const m = String(e);
      if (edit) setWerr(m);
      else note({ text: tr('일정을 못 바꿨어요 — 연결을 확인해 주세요', "Couldn't save — check the connection"), act: { label: tr('다시', 'Retry'), run: () => void write(it, id, data, restore) } });
      return false;
    } finally {
      setBusy(false);
    }
  };

  const move = (n: number) => setAnchor((a) => {
    if (view === 'week') return addDays(a, 7 * n);
    if (view === 'list') return addDays(a, 30 * n);
    const x = new Date(a.replace(/-/g, '/'));
    return ymd(new Date(x.getFullYear(), x.getMonth() + n, 1));
  });
  const title = view === 'week'
    ? `${new Date(days[0]!.replace(/-/g, '/')).toLocaleDateString(undefined, { month: 'long', day: 'numeric' })} – ${new Date(days[6]!.replace(/-/g, '/')).toLocaleDateString(undefined, { month: 'long', day: 'numeric' })}`
    : d.toLocaleDateString(undefined, { year: 'numeric', month: 'long' });
  const fresh = (o: Occ) => !!snap && o.item.by !== snap.me && Date.now() - o.item.at < 60_000;
  const chip = (o: Occ, time = true) => (
    <button key={o.key} className={`tcal-ev l-${o.label} ${o.done ? 'done' : ''} ${o.item.pending ? 'pend' : ''} ${fresh(o) ? 'fresh' : ''}`} onClick={(e) => { e.stopPropagation(); setOpen(o); }}
      title={o.title}>
      <i />{time && !o.allDay && <em>{new Date(o.startMs).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false })}</em>}<span>{o.title}</span>{o.repeat && <IconRepeat />}
    </button>
  );
  const gone = items.filter((x) => x.del && !x.why).sort((a, b) => (b.deletedAt ?? 0) - (a.deletedAt ?? 0));

  return (
    <div className={`tcal ${phone ? 'phone' : ''}`}>
      <div className="tcal-top">
        <b>{title}</b>
        <BetaTag />
        {(!phone || view === 'month') && <>
          <IconButton size={phone ? 'l' : 's'} tone="line" label={tr('이전', 'Previous')} onClick={() => move(-1)}><IconBack /></IconButton>
          <IconButton size={phone ? 'l' : 's'} tone="line" label={tr('다음', 'Next')} onClick={() => move(1)}><IconForward /></IconButton>
        </>}
        {!phone && <button className="tcal-today" onClick={() => setAnchor(today)}>{tr('오늘', 'Today')}</button>}
        <span className="tcal-sp" />
        {phone ? (
          <IconButton size="l" label={view === 'list' ? tr('월 보기', 'Month view') : tr('목록 보기', 'List view')} onClick={() => setView(view === 'list' ? 'month' : 'list')}>{view === 'list' ? <IconCalendar /> : <IconList />}</IconButton>
        ) : (
          <span className="tcal-seg" role="tablist" aria-label={tr('보기', 'View')}>
            {(['month', 'week', 'list'] as View[]).map((v) => (
              <button key={v} role="tab" aria-selected={view === v} className={view === v ? 'on' : ''} onClick={() => setView(v)}>
                {v === 'month' ? tr('월', 'Month') : v === 'week' ? tr('주', 'Week') : tr('목록', 'List')}
              </button>
            ))}
          </span>
        )}
        <span className="tcal-menuw">
          <IconButton size={phone ? 'l' : 's'} label={tr('더보기', 'More')} aria-haspopup="menu" onClick={() => setMenu((m) => !m)}><IconMore /></IconButton>
          {menu && (
            <div className="tcal-menu" role="menu" onMouseLeave={() => setMenu(false)}>
              <button role="menuitemcheckbox" aria-checked={hideDone} onClick={() => { const v = !hideDone; setHideDone(v); try { localStorage.setItem(hidePref, v ? '1' : '0'); } catch { /* 이 창만 */ } setMenu(false); }}>
                {hideDone ? tr('완료 보이기', 'Show done') : tr('완료 숨기기', 'Hide done')}
              </button>
              <button role="menuitem" onClick={() => { setTrash(true); setMenu(false); }}>{tr(`지운 일정${gone.length ? ` ${gone.length}` : ''}`, `Deleted${gone.length ? ` ${gone.length}` : ''}`)}</button>
            </div>
          )}
        </span>
        <IconButton size={phone ? 'l' : 's'} tone="pri" label={tr('일정 만들기', 'New event')} onClick={() => setEdit({ item: null, day: view === 'month' && anchor.slice(0, 7) !== today.slice(0, 7) ? anchor : today })}><IconPlus /></IconButton>
      </div>
      {err && !snap && <div className="tcal-banner" role="alert">{tr('팀 일정을 못 불러왔어요 — ', "Couldn't load team events — ")}{err}</div>}
      {snap?.cached && <div className="tcal-banner soft">{tr('마지막으로 받은 일정이에요 — 새로 받는 중', 'Showing the last events — refreshing')}</div>}

      {view === 'month' && (
        <div className="tcal-month" style={{ gridTemplateRows: `auto repeat(${days.length / 7}, minmax(0, 1fr))` }}>
          {DOW().map((n, i) => <div key={n} className={`tcal-dow ${i === 0 || i === 6 ? 'we' : ''}`}>{n}</div>)}
          {days.map((day) => {
            const list = cells.get(day) ?? [];
            return (
              <div key={day} className={`tcal-day ${day.slice(0, 7) !== anchor.slice(0, 7) ? 'out' : ''} ${day === today ? 'now' : ''}`} onDoubleClick={() => setEdit({ item: null, day })}>
                <div className="tcal-dn"><span>{Number(day.slice(8))}</span></div>
                {list.slice(0, 3).map((o) => chip(o, false))}
                {list.length > 3 && <button className="tcal-more" onClick={() => { setAnchor(day); setView('list'); }}>{tr(`+${list.length - 3}개`, `+${list.length - 3}`)}</button>}
              </div>
            );
          })}
        </div>
      )}

      {view === 'week' && (
        <div className="tcal-week">
          <div className="tcal-wh"><span />{days.map((day, i) => <span key={day} className={day === today ? 'now' : ''}>{DOW()[i] ?? ''}<b>{Number(day.slice(8))}</b></span>)}</div>
          <div className="tcal-wall"><span className="tcal-wlab">{tr('종일', 'All day')}</span>
            {days.map((day) => <div key={day} onDoubleClick={() => setEdit({ item: null, day })}>{(cells.get(day) ?? []).filter((o) => o.allDay).map((o) => chip(o))}</div>)}
          </div>
          <div className="tcal-wgrid">
            <div className="tcal-wtimes">{HOURS.map((h) => <span key={h} style={{ height: HOUR_PX }}>{`${h}:00`}</span>)}</div>
            {days.map((day) => (
              <div key={day} className="tcal-wcol" style={{ height: HOURS.length * HOUR_PX }} onDoubleClick={() => setEdit({ item: null, day })}>
                {(cells.get(day) ?? []).filter((o) => !o.allDay && o.day === day).map((o) => {
                  const s = new Date(o.startMs);
                  const top = Math.max(0, (s.getHours() + s.getMinutes() / 60 - HOURS[0]!) * HOUR_PX);
                  const h = Math.max(22, ((o.endMs - o.startMs) / 3_600_000) * HOUR_PX - 2);
                  return <div key={o.key} className="tcal-wblk" style={{ top, height: h }}>{chip(o)}</div>;
                })}
                {day === today && <i className="tcal-nowline" style={{ top: Math.max(0, (new Date().getHours() + new Date().getMinutes() / 60 - HOURS[0]!) * HOUR_PX) }} />}
              </div>
            ))}
          </div>
        </div>
      )}

      {view === 'list' && phone && (
        <div className="tcal-pstrip" role="group" aria-label={tr('이번 주', 'This week')}>
          {weekDays(anchor).map((day, i) => {
            const dots = occurrences(items, day, addDays(day, 1), { hideDone }).slice(0, 3);
            return (
              <button key={day} className={`${day === today ? 'now' : ''} ${day === anchor ? 'on' : ''}`} aria-pressed={day === anchor} onClick={() => setAnchor(day)}>
                {DOW()[i] ?? ''}<b>{Number(day.slice(8))}</b><em>{dots.map((o) => <i key={o.key} className={`l-${o.label}`} />)}</em>
              </button>
            );
          })}
        </div>
      )}
      {view === 'list' && (
        <div className="tcal-list">
          {days.filter((day) => (cells.get(day) ?? []).some((o) => o.day === day || day === days[0])).map((day) => {
            const list = (cells.get(day) ?? []).filter((o) => o.day === day || day === days[0]);
            if (!list.length) return null;
            return (
              <div key={day} className={`tcal-lday ${day === today ? 'now' : ''}`}>
                <div className="tcal-lh">{day === today ? tr('오늘 · ', 'Today · ') : ''}{new Date(day.replace(/-/g, '/')).toLocaleDateString(undefined, { month: 'long', day: 'numeric', weekday: 'short' })}</div>
                {list.map((o) => (
                  <button key={o.key} className={`tcal-lrow ${o.done ? 'done' : ''} ${o.item.pending ? 'pend' : ''}`} onClick={() => setOpen(o)}>
                    <span className="tcal-lt">{o.allDay ? tr('종일', 'All day') : new Date(o.startMs).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false })}</span>
                    <span className={`tcal-lx l-${o.label}`}><i /><span>{o.title}</span>{o.repeat && <IconRepeat />}</span>
                  </button>
                ))}
              </div>
            );
          })}
          {snap && !occ.length && <div className="tcal-empty">{tr('일정이 없어요', 'No events')}</div>}
        </div>
      )}

      {toast && (
        <div className="tcal-toast" role="status">
          <span>{toast.text}</span>
          {toast.act && <button onClick={() => { toast.act!.run(); setToast(null); }}>{toast.act.label}</button>}
        </div>
      )}

      {open && !edit && (
        <Dialog label={open.title} onClose={() => setOpen(null)}>
          <CalView occ={open} nameOf={nameOf} onClose={() => setOpen(null)}
            onEdit={() => { setEdit({ item: open.item, day: open.day }); setOpen(null); }}
            onDelete={() => { const o = open; setOpen(null); void write(o.item, o.id, null).then((ok) => ok && note({ text: tr('일정을 지웠어요', 'Event deleted'), act: { label: tr('되돌리기', 'Undo'), run: () => void write({ ...o.item, del: true }, o.id, o.item.data, true) } })); }}
            onSkip={open.repeat ? () => { const o = open; setOpen(null); void write(o.item, o.id, skipDay(o.item.data, o.day)); } : undefined}
            onDone={(on) => { const o = open; setOpen(null); void write(o.item, o.id, withDone(o.item.data, snap?.me ?? '', on)); }} />
        </Dialog>
      )}
      {edit && (
        <Dialog label={edit.item ? tr('일정 고치기', 'Edit event') : tr('일정 만들기', 'New event')} onClose={() => !busy && setEdit(null)}>
          <CalForm item={edit.item} day={edit.day} people={members} busy={busy} err={werr} onCancel={() => setEdit(null)}
            onSave={(data) => { const e = edit; void write(e.item, e.item?.id ?? newCalId(), data).then((ok) => ok && setEdit(null)); }} />
        </Dialog>
      )}
      {trash && (
        <Dialog label={tr('지운 일정', 'Deleted events')} onClose={() => setTrash(false)}>
          <div className="tcal-trash">
            <div className="tcal-s2">{tr('30일 뒤 사라져요 — 누구나 되살릴 수 있어요', 'Kept for 30 days — anyone can restore')}</div>
            {gone.length ? gone.map((x) => (
              <div key={x.id} className="tcal-trow">
                <span className={`tcal-vdot l-${x.data.label ?? 'blue'}`} />
                <span className="tcal-tt">{x.data.title}</span>
                <span className="tcal-s2">{tr(`${nameOf(x.by)} · ${stamp(x.deletedAt ?? x.at, Date.now())}`, `${nameOf(x.by)} · ${stamp(x.deletedAt ?? x.at, Date.now())}`)}</span>
                <button className="tmx-btn" disabled={busy} onClick={() => void write(x, x.id, x.data, true)}>{tr('되살리기', 'Restore')}</button>
              </div>
            )) : <div className="tcal-empty">{tr('지운 일정이 없어요', 'Nothing deleted')}</div>}
          </div>
        </Dialog>
      )}
    </div>
  );
}
