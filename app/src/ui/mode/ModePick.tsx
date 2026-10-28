// 모드 고르기(10/12 사용자 "내가 만든 것도 여기서, 여러 개 골라 켜기") — 홈 빈 칸과 홈 머리 '모드' 시트가 같은 목록을 쓴다.
// 위 '내가 만든 것'(folder·added·plugin), 아래 '참모 모드'(앱이 주는 맛보기 셋). 카드를 눌러 체크 → 켜기(차례로) · 체크 빼면 이 홈에서 끄기.
// 모드 하나 = 자리 하나(Rust modes.json) — 다른 자리에 켜진 걸 고르면 이 홈으로 옮겨 온다(카드에 지금 자리를 적는다)
import { invoke } from '@tauri-apps/api/core';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { tr } from '../../i18n';
import { IconBack, IconCheck, IconClose, IconSend, IconSettings } from '../Icons';
import { IconButton } from '../kit/IconButton';
import { openInTurn, pickDiff, pickGroups, type PickItem } from '../../domain/homeModes';
import type { ModeRow } from '../../domain/modeTree';
import { ModeManage } from './ModeManage';
import { ModeCardArt, useModeCard } from './ModeCardArt';
import { seenName } from '../../domain/session';

const loadCard = (name: string) => invoke('mode_card', { name });

/** 홈 맛보기 예시(Rust modes::HOME_TRY 와 같은 이름) — 고르면 빌드 없이 이 참모 홈에 바로 켜진다 */
export const HOME_TRY = [
  { name: 'home-calendar', title: () => tr('달력', 'Calendar') },
  { name: 'home-board', title: () => tr('현황판', 'Board') },
  { name: 'home-todo', title: () => tr('할 일', 'To-do') },
  { name: 'team-status', title: () => tr('참모 상태', 'Team') },
] as const;
const exampleTitle = (n: string) => HOME_TRY.find((x) => x.name === n)?.title() ?? n;

// 못 켠 것 — 빈 칸이 사라져도(첫 모드가 켜짐)·시트를 닫아도 홈 칸에 남게 컴포넌트 밖에 둔다. 닫거나 다시 켜면 지운다
let tryFail: string | null = null;
const failSubs = new Set<() => void>();
const setTryFail = (v: string | null) => { tryFail = v; failSubs.forEach((f) => f()); };
const subFail = (f: () => void) => { failSubs.add(f); return () => { failSubs.delete(f); }; };

export function TryFail() {
  const fail = useSyncExternalStore(subFail, () => tryFail);
  if (!fail) return null;
  return (
    <p className="mdv-try-err" role="alert">
      <span>{tr('못 바꿨어', "Couldn't change")} — {fail}</span>
      <IconButton size="s" label={tr('닫기', 'Dismiss')} onClick={() => setTryFail(null)}><IconClose /></IconButton>
    </p>
  );
}

/** 다른 자리에 켜졌으면 그 자리 한 마디 — 고르면 이리로 옮겨 온다 */
const elsewhereText = (e: NonNullable<PickItem['elsewhere']>) =>
  e.where === 'dash' && e.dash ? tr(`${seenName(e.dash)} 홈에 켜짐`, `On ${seenName(e.dash)}'s home`)
    : e.where === 'panel' ? tr('패널에 켜짐', 'On in the panel')
      : e.where === 'window' ? tr('따로 창에 켜짐', 'On in a window')
        : tr('다른 자리에 켜짐', 'On elsewhere');

function Card({ it, on, busy, onToggle }: { it: PickItem; on: boolean; busy: boolean; onToggle: () => void }) {
  const art = useModeCard(it.name, loadCard);
  return (
    <button type="button" role="checkbox" aria-checked={on} className={`mdv-try-card t-${it.example ? it.name : 'own'}${on ? ' on' : ''}`} disabled={busy} onClick={onToggle}
      title={it.elsewhere ? tr('고르면 이 홈으로 옮겨 와', 'Picking moves it here') : undefined}>
      <span className={`mdv-try-pv${art ? ' has-art' : ''}`} aria-hidden="true"><ModeCardArt art={art} fallback={<><i /><i /><i /><i /><i /><i /></>} />{on && <span className="mdv-pick-mark"><IconCheck /></span>}</span>
      <b>{it.title}</b>
      {it.elsewhere && <small>{elsewhereText(it.elsewhere)}</small>}
    </button>
  );
}

/** 고르기 목록 — 빈 칸(variant empty)·시트(sheet)가 같이 쓴다. dash = 이 참모 이름(대시보드 칸 자리), keys = 이 참모를 가리키는 말 */
export function ModePick({ rows, keys, dash, onAsk, onDone, variant }: {
  rows: ModeRow[]; keys: string[]; dash: string; onAsk: (text: string) => void; onDone?: () => void; variant: 'empty' | 'sheet';
}) {
  const g = pickGroups(rows, keys, exampleTitle);
  const all = [...g.own, ...g.examples];
  const here = all.filter((x) => x.here).map((x) => x.name);
  const [chosen, setChosen] = useState<string[]>(here);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const diff = pickDiff(here, chosen);
  const toggle = (n: string) => setChosen((c) => (c.includes(n) ? c.filter((x) => x !== n) : [...c, n]));
  // 켤 것 먼저 차례로, 그다음 끌 것 — 하나씩(한꺼번에 쏘면 기억 쓰기가 겹친다). 못 바꾼 건 홈 칸에 남는 줄로
  const apply = () => {
    setBusy(true);
    setTryFail(null);
    void (async () => {
      const failed = [
        ...await openInTurn(diff.open, (name) => invoke('mode_open', { name, place: 'dash', dash })),
        ...await openInTurn(diff.close, (name) => invoke('mode_close', { name })),
      ];
      setBusy(false);
      if (failed.length) setTryFail(failed.map((f) => `${all.find((x) => x.name === f.name)?.title ?? f.name}: ${f.error}`).join(' · '));
      onDone?.();
    })();
  };
  const ask = () => { const t = text.trim(); if (!t) return; onAsk(t); setText(''); onDone?.(); };
  const applyLabel = diff.open.length && diff.close.length ? tr('적용', 'Apply') : diff.close.length ? tr('끄기', 'Turn off') : tr('켜기', 'Open');
  const cards = (items: PickItem[]) => (
    <div className="mdv-try-cards">{items.map((it) => <Card key={it.name} it={it} on={chosen.includes(it.name)} busy={busy} onToggle={() => toggle(it.name)} />)}</div>
  );
  return (
    <div className={`mdv-pick ${variant}`}>
      {g.own.length > 0 ? (
        <>
          <section aria-label={tr('내가 만든 것', 'Made by me')}><h4>{tr('내가 만든 것', 'Made by me')}</h4>{cards(g.own)}</section>
          <section aria-label={tr('참모 모드', 'Chammo modes')}><h4>{tr('참모 모드', 'Chammo modes')}</h4>{cards(g.examples)}</section>
        </>
      ) : cards(g.examples)}
      <div className="mdv-try-say">
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder={tr('말로 새 모드 만들기 — 예: 거래처별 미수금', 'Describe a new mode — e.g. unpaid invoices by client')}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) ask(); }} aria-label={tr('만들 모드 말하기', 'Describe a mode')} />
        <IconButton label={tr('참모에게 보내기', 'Send to the assistant')} onClick={ask} disabled={!text.trim()}><IconSend /></IconButton>
      </div>
      <button type="button" className="btn pri mdv-pick-go" disabled={busy || (!diff.open.length && !diff.close.length)} onClick={apply}>
        {applyLabel}{diff.open.length + diff.close.length > 1 ? ` ${diff.open.length + diff.close.length}` : ''}
      </button>
      {variant === 'empty' && <TryFail />}
    </div>
  );
}

/** 모드가 하나도 없을 때(홈·모드 v1 4·5) — 빈 칸 하나: 고르기 목록. 글은 제목 한 줄 + 한 줄 */
export function ModeTry({ rows, keys, dash, onAsk }: { rows: ModeRow[]; keys: string[]; dash: string; onAsk: (text: string) => void }) {
  const [manage, setManage] = useState(false);
  return (
    <section className="mdv-try" aria-label={tr('모드 만들어 보기', 'Try a mode')}>
      <h3>{tr('모드 만들어 보기', 'Try a mode')}<IconButton label={tr('모드 관리', 'Manage modes')} onClick={() => setManage(true)}><IconSettings /></IconButton></h3>
      {manage && <ModeSheet rows={rows} keys={keys} dash={dash} onAsk={onAsk} onClose={() => setManage(false)} start="manage" />}
      <p>{tr('골라서 켜. 내 식으로 고치는 건 참모에게 말하면 돼.', 'Pick and open. To change one, just ask.')}</p>
      <ModePick rows={rows} keys={keys} dash={dash} onAsk={onAsk} variant="empty" />
    </section>
  );
}

/** 홈 머리 '모드' 시트 — 덮개(바깥·Esc = 닫기). 연 동안 목록이 바뀌어도 고르던 건 그대로(열 때 한 번 읽은 체크로 시작).
 *  머리 '관리' = 같은 시트 안에서 관리 화면으로(뒤로 = 고르기, 다시 열면 그때 목록으로 체크를 새로 잡는다) */
export function ModeSheet({ rows, keys, dash, onAsk, onClose, start = 'pick' }: { rows: ModeRow[]; keys: string[]; dash: string; onAsk: (text: string) => void; onClose: () => void; start?: 'pick' | 'manage' }) {
  const [view, setView] = useState(start);
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.isComposing) return;
      e.preventDefault();
      e.stopPropagation();
      onClose();
    };
    window.addEventListener('keydown', on, true);
    return () => window.removeEventListener('keydown', on, true);
  }, [onClose]);
  return createPortal(
    <div className="mdv-sheet" onClick={onClose}>
      <div className="mdv-sheet-box" role="dialog" aria-modal="true" aria-label={view === 'manage' ? tr('모드 관리', 'Manage modes') : tr('모드 고르기', 'Pick modes')} onClick={(e) => e.stopPropagation()}>
        <header className="mdv-panel-head">
          {view === 'manage' && <IconButton label={tr('고르기로', 'Back to picking')} onClick={() => setView('pick')}><IconBack /></IconButton>}
          <b>{view === 'manage' ? tr('모드 관리', 'Manage modes') : tr('모드', 'Modes')}</b>
          <span className="mdv-sp" />
          {view === 'pick' && <IconButton label={tr('모드 관리', 'Manage modes')} onClick={() => setView('manage')}><IconSettings /></IconButton>}
          <IconButton label={tr('닫기', 'Close')} onClick={onClose}><IconClose /></IconButton>
        </header>
        {view === 'manage' ? <ModeManage /> : <ModePick rows={rows} keys={keys} dash={dash} onAsk={onAsk} onDone={onClose} variant="sheet" />}
      </div>
    </div>,
    document.body,
  );
}
