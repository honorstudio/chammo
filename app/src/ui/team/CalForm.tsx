// 팀 캘린더 만들기·고치기 칸 + 열어 보기(누가 고쳤나·완료·지우기) — 시안 v2 E. 칸 이름 대신 아이콘, 값은 글. '저장'은 팀 모두에게 바로 보이는 일이라 글자 단추
import { useState } from 'react';
import { tr } from '../../i18n';
import { stamp } from '../../domain/teamChat';
import { cleanDraft, draftOf, LABELS, type CalData, type CalItem, type Draft, type Label, type Occ } from '../../domain/teamCal';
import { IconButton } from '../kit/IconButton';
import { IconCheck, IconClose, IconPencil, IconPeople, IconPlace, IconRepeat, IconTrash, IconNote, IconCalendar } from '../Icons';

type Person = { id: string; name: string };

const LABEL_NAME: Record<Label, () => string> = {
  blue: () => tr('파랑', 'Blue'), green: () => tr('초록', 'Green'), orange: () => tr('주황', 'Orange'), purple: () => tr('보라', 'Purple'), gray: () => tr('회색', 'Gray'),
};

export function CalForm({ item, day, people, busy, err, onSave, onCancel }: {
  item: CalItem | null;
  day: string;
  people: Person[];
  busy: boolean;
  err: string;
  onSave: (data: CalData) => void;
  onCancel: () => void;
}) {
  const [f, setF] = useState<Draft>(() => draftOf(item, day));
  const [why, setWhy] = useState('');
  const set = (p: Partial<Draft>) => setF((x) => ({ ...x, ...p }));
  const save = () => {
    const r = cleanDraft(f, item?.data);
    if (r.error || !r.data) return setWhy(r.error ?? '');
    setWhy('');
    onSave(r.data);
  };
  const toggle = (id: string) => set({ people: f.people.includes(id) ? f.people.filter((x) => x !== id) : [...f.people, id] });
  return (
    <div className="tcal-form" onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) save(); }}>
      <input className="tcal-title" autoFocus placeholder={tr('일정 제목', 'Event title')} maxLength={200} value={f.title} onChange={(e) => set({ title: e.target.value })}
        onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) save(); }} />
      <div className="tcal-row">
        <span className="tcal-ic" title={tr('날짜·시간', 'Date and time')}><IconCalendar /></span>
        <div className="tcal-fv">
          <input type="date" aria-label={tr('날짜', 'Date')} value={f.date} onChange={(e) => set({ date: e.target.value, endDate: f.endDate < e.target.value ? e.target.value : f.endDate })} />
          {f.allDay ? (
            <><span className="tcal-dash">–</span><input type="date" aria-label={tr('끝나는 날', 'End date')} value={f.endDate} min={f.date} onChange={(e) => set({ endDate: e.target.value })} /></>
          ) : (
            <><input type="time" aria-label={tr('시작', 'Start')} value={f.from} onChange={(e) => set({ from: e.target.value })} /><span className="tcal-dash">–</span>
              <input type="time" aria-label={tr('끝', 'End')} value={f.to} onChange={(e) => set({ to: e.target.value })} /></>
          )}
          <label className="tcal-sw"><input type="checkbox" role="switch" checked={f.allDay} onChange={(e) => set({ allDay: e.target.checked })} /><span>{tr('하루 종일', 'All day')}</span></label>
        </div>
      </div>
      <div className="tcal-row">
        <span className="tcal-ic" title={tr('반복', 'Repeat')}><IconRepeat /></span>
        <div className="tcal-fv">
          <select aria-label={tr('반복', 'Repeat')} value={f.repeat} onChange={(e) => set({ repeat: e.target.value as Draft['repeat'] })}>
            <option value="">{tr('반복 안 함', 'Does not repeat')}</option>
            <option value="week">{tr('매주', 'Weekly')}</option>
            <option value="2week">{tr('격주', 'Every 2 weeks')}</option>
            <option value="month">{tr('매월', 'Monthly')}</option>
          </select>
          {f.repeat && <><span className="tcal-s2">{tr('끝나는 날', 'Until')}</span><input type="date" aria-label={tr('반복 끝나는 날', 'Repeat until')} value={f.until} min={f.date} onChange={(e) => set({ until: e.target.value })} /></>}
        </div>
      </div>
      {people.length > 0 && (
        <div className="tcal-row">
          <span className="tcal-ic" title={tr('담당', 'People')}><IconPeople /></span>
          <div className="tcal-fv">
            {people.map((p) => (
              <button key={p.id} type="button" className={`tcal-pick ${f.people.includes(p.id) ? 'on' : ''}`} aria-pressed={f.people.includes(p.id)} onClick={() => toggle(p.id)}>{p.name}</button>
            ))}
          </div>
        </div>
      )}
      <div className="tcal-row">
        <span className="tcal-ic" title={tr('장소', 'Place')}><IconPlace /></span>
        <input className="tcal-in" placeholder={tr('장소', 'Place')} maxLength={200} value={f.place} onChange={(e) => set({ place: e.target.value })} />
      </div>
      <div className="tcal-row top">
        <span className="tcal-ic" title={tr('메모', 'Note')}><IconNote /></span>
        <textarea className="tcal-note" placeholder={tr('메모', 'Note')} maxLength={2000} value={f.note} onChange={(e) => set({ note: e.target.value })} />
      </div>
      <div className="tcal-foot">
        <span className="tcal-dots" role="radiogroup" aria-label={tr('색', 'Color')}>
          {LABELS.map((l) => (
            <button key={l} type="button" role="radio" aria-checked={f.label === l} aria-label={LABEL_NAME[l]()} title={LABEL_NAME[l]()} className={`tcal-dot l-${l} ${f.label === l ? 'on' : ''}`} onClick={() => set({ label: l })} />
          ))}
        </span>
        <span className="tcal-sp" />
        <button className="tmx-btn" disabled={busy} onClick={onCancel}>{tr('취소', 'Cancel')}</button>
        <button className="tmx-btn pri" disabled={busy || !f.title.trim()} onClick={save}>{tr('저장', 'Save')}</button>
      </div>
      {(why || err) && <div className="tmh-err" role="alert">{why || err}</div>}
    </div>
  );
}

const when = (o: Occ) => {
  const d = new Date(o.startMs);
  const day = d.toLocaleDateString(undefined, { month: 'long', day: 'numeric', weekday: 'short' });
  if (o.allDay) {
    if (o.endDay === o.day) return `${day} · ${tr('하루 종일', 'all day')}`;
    const e = new Date(o.endDay.replace(/-/g, '/'));
    return `${day} – ${e.toLocaleDateString(undefined, { month: 'long', day: 'numeric', weekday: 'short' })}`;
  }
  const t = (ms: number) => new Date(ms).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false });
  return `${day} ${t(o.startMs)} – ${t(o.endMs)}`;
};

const FIELD: Record<string, () => string> = {
  title: () => tr('제목', 'title'), start: () => tr('시간', 'time'), end: () => tr('시간', 'time'), allDay: () => tr('시간', 'time'), note: () => tr('메모', 'note'),
  place: () => tr('장소', 'place'), people: () => tr('담당', 'people'), label: () => tr('색', 'color'), repeat: () => tr('반복', 'repeat'), done: () => tr('완료', 'done'),
};
const fields = (f: string[]) => [...new Set(f.map((k) => (FIELD[k] ? FIELD[k]() : k)))].join('·');

export function CalView({ occ, nameOf, onEdit, onDelete, onSkip, onDone, onClose }: {
  occ: Occ;
  nameOf: (id: string) => string;
  onEdit: () => void;
  onDelete: () => void;
  /** 반복 일정의 이 날만 빼기 */
  onSkip?: () => void;
  onDone: (on: boolean) => void;
  onClose: () => void;
}) {
  const d = occ.item.data;
  const edits = [...(d.edits ?? [])].reverse();
  const last = edits[0];
  return (
    <div className="tcal-view">
      <div className="tcal-vbar">
        <span className={`tcal-vdot l-${occ.label}`} />
        <h3>{occ.title}</h3>
        <span className="tcal-sp" />
        <IconButton label={tr('고치기', 'Edit')} onClick={onEdit}><IconPencil /></IconButton>
        <IconButton label={tr('지우기', 'Delete')} onClick={onDelete}><IconTrash /></IconButton>
        <IconButton label={tr('닫기', 'Close')} onClick={onClose}><IconClose /></IconButton>
      </div>
      <div className="tcal-row"><span className="tcal-ic"><IconCalendar /></span><span>{when(occ)}</span></div>
      {d.repeat && <div className="tcal-row"><span className="tcal-ic"><IconRepeat /></span><span>{d.repeat.every === 'week' ? tr('매주', 'Weekly') : d.repeat.every === '2week' ? tr('격주', 'Every 2 weeks') : tr('매월', 'Monthly')}{d.repeat.until ? tr(` · ${d.repeat.until} 까지`, ` · until ${d.repeat.until}`) : ''}</span></div>}
      {!!d.people?.length && <div className="tcal-row"><span className="tcal-ic"><IconPeople /></span><span>{d.people.map(nameOf).join(', ')}</span></div>}
      {d.place && <div className="tcal-row"><span className="tcal-ic"><IconPlace /></span><span>{d.place}</span></div>}
      {d.note && <div className="tcal-row top"><span className="tcal-ic"><IconNote /></span><span className="tcal-vnote">{d.note}</span></div>}
      {!d.repeat && (
        <label className="tcal-done">
          <input type="checkbox" checked={!!d.done} onChange={(e) => onDone(e.target.checked)} />
          <span>{d.done ? tr(`완료 · ${nameOf(d.done.by)} ${stamp(d.done.at, Date.now())}`, `Done · ${nameOf(d.done.by)} ${stamp(d.done.at, Date.now())}`) : tr('완료', 'Done')}</span>
          {d.done && <IconCheck />}
        </label>
      )}
      {onSkip && <button className="tcal-link" onClick={onSkip}>{tr('이 날만 빼기', 'Skip this date')}</button>}
      <div className="tcal-who">
        {last ? tr(`${nameOf(last.by)}님이 ${stamp(last.at, Date.now())} ${fields(last.f)} 바꿈`, `${nameOf(last.by)} changed the ${fields(last.f)} ${stamp(last.at, Date.now())}`) : ''}
        {d.made ? tr(`${last ? ' · ' : ''}만든 사람 ${nameOf(d.made.by)}`, `${last ? ' · ' : ''}made by ${nameOf(d.made.by)}`) : ''}
      </div>
      {edits.length > 1 && (
        <details className="tcal-hist">
          <summary>{tr(`고친 기록 ${edits.length}`, `${edits.length} edits`)}</summary>
          {edits.map((e, i) => <div key={i}><span>{nameOf(e.by)} · {fields(e.f)}</span><em>{stamp(e.at, Date.now())}</em></div>)}
        </details>
      )}
    </div>
  );
}
