// 폰 참모 깨우기 — 데스크톱 오케스트레이터 홈(ui/space/OrchHome)을 폰에. 꺼진 참모 줄(프사·별명·마지막 때·하던 일)을 누르면
// 그 대화만 다시 켜고(/api/respawn), 새 참모는 별명만 지어 보낸다(/api/spawn — 번호는 서버가). 켜진 참모가 목록에 뜨면 그리로 옮긴다
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { machine, tr } from '../../i18n';
import { roleChips } from '../../domain/orchRoles';
import { listStoppedOrchs, readTails, respawnOrch, spawnOrch, type MobileEnv } from '../../data/web';
import { offOrchRows, phoneName, wakeAlreadyText, wakeFailText, wokeOrch } from '../../domain/mobile';
import { nickProblem } from '../../domain/orchLabel';
import { whenLabel, type HomeRow } from '../../domain/orchHome';
import type { Session } from '../../domain/session';
import { bodyColor, OrchAvatar, orchColor, useAvatars } from '../avatar';
import { IconResume, IconTrash } from '../Icons';
import { useMemoPoll } from './usePoll';
import { remember, remembered } from './memo';
import { SwipeRow } from './SwipeRow';
import { RowConfirm } from './RowConfirm';
import { Notice } from './Notice';

/** 꺼진 참모 줄 — 떠 있는 동안 15초마다(claude agents --all 은 가볍지 않다). 하던 일은 꼬리를 한 번씩.
 *  꼬리는 기억(offTails)에 두고 앱 처음 열 때 미리 받아 둔다(bootPreload) — 시트를 열 때 받으면 줄이 이름만 나왔다가 커졌다(2026-10-03 사용자).
 *  tailsFor = 꼬리를 받아 본 대화 id(아직이면 줄에 뼈대) */
export function useOffOrchs(env: MobileEnv, live: Session[]): HomeRow[] & { tailsFor?: Set<string> } {
  const [raw, , kick] = useMemoPoll('stopped', listStoppedOrchs, 15_000, '[]');
  // 켜기가 '이미 켜졌거나 지워짐'으로 실패하면 목록이 낡은 것 — 15초를 안 기다리고 바로 다시(useWake 가 알린다)
  useEffect(() => {
    window.addEventListener(OFF_REFRESH, kick);
    return () => window.removeEventListener(OFF_REFRESH, kick);
  }, [kick]);
  const base = offOrchRows(raw, env, live, {});
  const ids = base.map((r) => r.off!.sessionId).slice(0, 12).join(',');
  const [tails, setTails] = useState<Record<string, string>>(() => remembered<Record<string, string>>(OFF_TAILS) ?? {});
  const [tailsFor, setTailsFor] = useState<Set<string>>(() => new Set(Object.keys(remembered<Record<string, string>>(OFF_TAILS) ?? {})));
  useEffect(() => {
    if (!ids) return;
    let alive = true;
    readTails(ids.split(',')).then((t) => {
      const all = { ...(remembered<Record<string, string>>(OFF_TAILS) ?? {}), ...t };
      remember(OFF_TAILS, all);
      if (alive) { setTails(all); setTailsFor(new Set([...Object.keys(all), ...ids.split(',')])); }
    }, () => {});
    return () => { alive = false; };
  }, [ids]);
  return Object.assign(offOrchRows(raw, env, live, tails), { tailsFor });
}
export const OFF_TAILS = 'offTails';
const OFF_REFRESH = 'm-off-refresh';
/** 꺼진 목록을 15초 안 기다리고 바로 다시 받기 — 재운 줄이 '꺼져 있음'에 바로 내려앉게 */
export const refreshOff = () => window.dispatchEvent(new Event(OFF_REFRESH));

type Woke = { sessionId?: string; name?: string; at: number };
/** 이만큼 지나도 목록에 안 뜨면 못 켠 걸로 */
const ARRIVE_MS = 90_000;

/** 켜기·만들기 결과 — 가운데 알림 모달(Notice). 정보(이미 켜져 있음)는 몇 초 뒤, 오류는 사람이 닫을 때까지. 시트를 다시 열면 지운다
 *  (예전 맨 위 줄은 8초 뒤 지웠다 — 2026-10-05 '못 켰어요'가 시트에 한 시간 가까이 남아서. 모달은 눈앞이라 닫을 때까지 둔다) */
export type WakeNote = { text: string; error: boolean };

/** 깨우기 상태 — 켜는 중인 대화·새 참모, 켜지면 onArrive(그 참모 id) */
export function useWake(live: Session[], onArrive: (id: string) => void) {
  const [woke, setWoke] = useState<Woke | null>(null);
  const [note, setNote] = useState<WakeNote | null>(null);
  const arrive = useRef(onArrive);
  arrive.current = onArrive;
  useEffect(() => {
    const id = wokeOrch(woke, live);
    if (id) { setWoke(null); arrive.current(id); return; }
    if (woke && Date.now() - woke.at > ARRIVE_MS) { setWoke(null); setNote({ text: tr(`켜는 데 너무 오래 걸려요 — ${machine()}에서 확인해 주세요`, `Taking too long — check on the ${machine()}`), error: true }); }
  }, [woke, live]);
  const fail = (e: unknown, mode: 'wake' | 'make') => {
    const f = wakeFailText((e as Error).message ?? '', mode);
    if (f.refresh) window.dispatchEvent(new Event(OFF_REFRESH));
    setNote({ text: f.text, error: true });
  };
  const wake = async (r: HomeRow) => {
    if (woke || !r.off) return;
    setNote(null);
    setWoke({ sessionId: r.off.sessionId, at: Date.now() });
    try {
      // 이미 켜져 있었으면(낡은 목록) 서버는 다시 켜지 않는다 — 그대로 기다리면 목록에 떠서 그리로 옮긴다
      if ((await respawnOrch(r.off.sessionId)).already) { setNote({ text: wakeAlreadyText(), error: false }); window.dispatchEvent(new Event(OFF_REFRESH)); }
    } catch (e) { setWoke(null); fail(e, 'wake'); }
  };
  const make = async (nick: string, role = ''): Promise<boolean> => {
    if (woke) return false;
    setNote(null);
    try {
      const name = await spawnOrch(nick, role);
      setWoke({ name, at: Date.now() });
      return true;
    } catch (e) {
      fail(e, 'make');
      return false;
    }
  };
  const clearNote = useCallback(() => setNote(null), []);
  return { starting: woke?.sessionId ?? null, making: woke?.name ?? null, note, clearNote, wake, make };
}

/** 켜기·만들기 결과 모달 */
export function WakeNotice({ wake }: { wake: Wake }) {
  if (!wake.note) return null;
  return <Notice text={wake.note.text} error={wake.note.error} onClose={wake.clearNote} />;
}
export type Wake = ReturnType<typeof useWake>;

/** 꺼진 참모 줄 하나 — 줄 전체가 '이어서 켜기' */
function OffRow({ r, orchs, busy, disabled, onPress }: { r: HomeRow; orchs: Session[]; busy: boolean; disabled: boolean; onPress: () => void }) {
  const { saved } = useAvatars();
  const s = r.off!;
  const nm = phoneName(s.name, orchs);
  // 작은 한 줄(시안 phone-dash O1) — 프사·이름·마지막 때. 누르면 깨우기 확인(▶ 글자 없이), 하던 일은 길게 눌러 메뉴
  return (
    <button type="button" className="m-offrow" disabled={disabled} onClick={onPress} aria-label={`${nm} — 꺼져 있음, 깨우기`}>
      <OrchAvatar name={s.name} label={nm} size={28} state={busy ? 'rest' : 'off'} color={bodyColor(saved, s.name, orchColor(s.name))} />
      <span className="m-offrow-name">{nm}</span>
      <span className="m-offrow-when">{busy ? '켜는 중…' : whenLabel(r.lastAt, Date.now())}</span>
    </button>
  );
}

/** 꺼진 참모 목록 — 참모 바꾸기 시트 아래·참모가 하나도 없을 때. 줄을 누르면 '깨울까요?' 한 번 */
/** swipe = 참모 바꾸기 시트에서 줄을 밀면 '깨우기'·'제거'(참모 없음 화면엔 없음) */
export function OffOrchList({ rows, orchs, wake, swipe }: { rows: HomeRow[]; orchs: Session[]; wake: Wake; swipe?: { openId: string | null; setOpenId: (id: string | null) => void; onRemove: (r: HomeRow) => void; onMenu?: (r: HomeRow) => void; confirm?: (r: HomeRow) => ReactNode } }) {
  const [ask, setAsk] = useState<HomeRow | null>(null);
  if (!rows.length) return null;
  const nmOf = (r: HomeRow) => phoneName(r.off!.name, orchs);
  return (
    <>
      <div className="m-sect">꺼져 있음 {rows.length}</div>
      <div className="m-offlist">
        {rows.map((r) => {
          // 확인은 그 줄 자리에(2026-10-23 사용자 — 머리 아래 칸은 아래 줄에서 안 보였다): 제거는 시트가, 깨우기는 여기서
          const confirm = swipe?.confirm?.(r);
          if (confirm) return confirm;
          if (ask?.key === r.key) return (
            <RowConfirm key={r.key} label="깨우기 확인" q={`${nmOf(r)} 깨울까요?`} note={r.doing || '하던 대화 그대로 이어서 켜요.'} ok="깨우기"
              busy={!!wake.starting || !!wake.making} onOk={() => { setAsk(null); void wake.wake(r); }} onCancel={() => setAsk(null)} />
          );
          const row = <OffRow key={r.key} r={r} orchs={orchs} busy={wake.starting === r.off!.sessionId} disabled={!!wake.starting || !!wake.making} onPress={() => setAsk(r)} />;
          if (!swipe) return row;
          return (
            <SwipeRow key={r.key} id={`off:${r.off!.id}`} openId={swipe.openId} setOpenId={swipe.setOpenId} onMenu={swipe.onMenu ? () => swipe.onMenu!(r) : undefined} menuLabel={`${nmOf(r)} 메뉴`} actions={[
              { label: '깨우기', icon: <IconResume />, onPress: () => void wake.wake(r) },
              { label: '제거', icon: <IconTrash />, danger: true, onPress: () => swipe.onRemove(r) },
            ]}>{row}</SwipeRow>
          );
        })}
      </div>
    </>
  );
}

/** 새 참모 이름 짓기 — 별명만(무슨 일을 시킬지로). 겹치면 바로 알린다(서버도 다시 본다) */
export function NewOrchForm({ title, taken, wake, onDone }: { title: string; taken: string[]; wake: Wake; onDone: () => void }) {
  const [v, setV] = useState('');
  const [role, setRole] = useState(''); // 맡은 일 — 이름과 따로, 비워도 된다(2026-10-04)
  const [sending, setSending] = useState(false);
  const problem = v.trim() ? nickProblem(v, taken) : null;
  const submit = async () => {
    if (!v.trim() || problem || sending) return;
    setSending(true);
    const ok = await wake.make(v, role);
    setSending(false);
    if (ok) onDone();
  };
  return (
    <form className="m-new" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
      <label className="m-sect" htmlFor="m-new-nick">새 {title} 이름</label>
      <input id="m-new-nick" className="m-new-input" value={v} maxLength={24} autoFocus enterKeyHint="done" placeholder="부를 이름 — 예: 뽀삐, 개발" onChange={(e) => setV(e.target.value)} />
      {problem && <div className="m-error">{problem}</div>}
      <PhoneRoleField value={role} onChange={setRole} />
      <div className="m-new-row">
        <button type="button" className="m-btn" onClick={onDone}>취소</button>
        <button type="submit" className="m-send" disabled={!v.trim() || !!problem || sending}>만들기</button>
      </div>
    </form>
  );
}

/** 맡은 일 칸 + 예시 칩(글자) — 칩을 누르면 칸을 그 글로. 비워도 된다(데스크톱 RoleField 와 같은 칩) */
export function PhoneRoleField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <>
      <input className="m-new-input" value={value} maxLength={80} enterKeyHint="done" aria-label="맡은 일" placeholder="맡은 일(비워도 돼요)" onChange={(e) => onChange(e.target.value)} />
      <div className="m-chips">
        {roleChips().map((c) => <button key={c} type="button" className={value.trim() === c ? 'm-chip m-on' : 'm-chip'} onClick={() => onChange(c)}>{c}</button>)}
      </div>
    </>
  );
}
