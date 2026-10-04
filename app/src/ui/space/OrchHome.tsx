import { useEffect, useState } from 'react';
import { readTranscriptTails } from '../../data/tauri';
import { summarizeTranscript, type Activity } from '../../domain/activity';
import { homeAction, homeRows, whenLabel, type HomeRow } from '../../domain/orchHome';
import type { Session } from '../../domain/session';
import type { SnapSession } from '../../domain/revive';
import type { StoppedSession } from '../../domain/stopped';
import { assistant, josa, tr } from '../../i18n';
import { BrandMark, OrchAvatar, avatarState } from '../avatar';
import { IconPause, IconPlus, IconResume } from '../Icons';
import { Ctx } from '../Sidebar';
import type { LiveLine } from './DashboardView';
import './orchHome.css';

/**
 * 오케스트레이터 홈 — 참모가 하나도 안 떠 있을 때(또는 메뉴 '오케스트레이터' 머리를 누르면) 어떤 참모를 켤지 고르는 화면.
 * 앱은 스스로 참모를 켜지 않는다(2026-10-03 사용자). 켜진 참모는 위(지금 상태 한 줄), 꺼진 참모는 마지막으로 일한 때 최근 순.
 * 줄을 누르면 켜진 참모는 그리로, 꺼진 참모는 그 대화만 이어서 켠다(켜지면 부르는 쪽이 그 참모로 옮긴다)
 */
export function OrchHome({ live, off, ctx, lines, starting, ready, creating, waiting = [], nameOf, colorOf, onGo, onResume, onNew }: {
  live: Session[];
  off: StoppedSession[];
  ctx: Record<string, { used: number }>;
  /** 켜진 참모 지금 하는 일 한 줄(대시보드와 같은 것) */
  lines: Record<string, LiveLine>;
  /** 켜는 중인 꺼진 참모 sessionId */
  starting: Set<string>;
  /** 꺼진 세션 목록을 한 번이라도 읽었나 — 읽기 전에 '기록 없음'을 크게 띄우지 않게 */
  ready: boolean;
  /** 지금 만드는 새 참모(진짜 이름) — 뜰 때까지 위에 '만드는 중' 줄 */
  creating?: string | null;
  /** 재시작으로 멈췄는데 알릴 참모가 없는 일(domain/lostTriage hold) — 참모를 켜면 앱이 그 참모에게 넘긴다 */
  waiting?: SnapSession[];
  nameOf: (s: { id: string; name: string }) => string;
  /** 참모 이름 → 기본 색 */
  colorOf: (name: string) => string;
  onGo: (id: string) => void;
  onResume: (s: StoppedSession) => void;
  /** 새 참모 — 이름 짓기 창 */
  onNew?: () => void;
}) {
  // 꺼진 참모의 마지막 하던 일 — 대화 기록 꼬리(켜진 참모는 부르는 쪽이 이미 읽는다). 홈이 떠 있는 동안 30초마다
  const [act, setAct] = useState<Record<string, Activity>>({});
  const offKey = off.map((x) => x.sessionId).join(',');
  useEffect(() => {
    if (!offKey) return;
    let alive = true;
    const tick = () => void readTranscriptTails(offKey.split(',')).then((m) => {
      if (alive) setAct(Object.fromEntries(Object.entries(m).map(([k, v]) => [k, summarizeTranscript(v)])));
    }, () => {});
    tick();
    const t = window.setInterval(tick, 30_000);
    return () => { alive = false; window.clearInterval(t); };
  }, [offKey]);

  const rows = homeRows({ live, off, activity: act, ctx });
  const now = Date.now();
  const pick = (r: HomeRow) => { const a = homeAction(r); if (a.kind === 'go') onGo(a.id); else onResume(a.session); };

  const row = (r: HomeRow) => {
    const s = r.live ?? r.off!;
    const nm = nameOf(s) || assistant();
    const on = !!r.live;
    const busy = !on && starting.has(r.off!.sessionId);
    const l = r.live ? lines[r.live.id] : undefined;
    const doing = on ? l?.line ?? '' : r.doing;
    return (
      <button key={r.key} className={`oh-row ${on ? 'st-on' : 'st-off'}`} disabled={busy} onClick={() => pick(r)}
        title={on ? tr(`${nm}로 가기`, `Go to ${nm}`) : tr(`${nm} 이어서 켜기`, `Resume ${nm}`)}>
        <OrchAvatar name={s.name} size={36} state={busy ? 'rest' : r.live ? avatarState(r.live) : 'off'} color={colorOf(s.name)} label={nm} />
        <span className="oh-txt">
          <span className="oh-l1">
            <b>{nm}</b>
            {on && l?.status === 'run' && <span className="cv-spin" />}
            {!on && <span className="oh-when">{busy ? tr('켜는 중…', 'Starting…') : whenLabel(r.lastAt, now)}</span>}
            <Ctx v={r.ctx} />
          </span>
          <span className="oh-l2">{doing || (on ? tr('쉼', 'Idle') : '')}</span>
        </span>
        {!on && !busy && <span className="oh-go" aria-hidden><IconResume /></span>}
      </button>
    );
  };

  const empty = ready && !live.length && !off.length && !creating;
  // 버튼 없이 한 줄 — 무엇을 누를지 고르게 하지 않는다. 참모를 켜면 앱이 넘기고 참모가 판단한다(2026-10-04 사용자)
  const wait = waiting.length > 0 && (
    <div className="oh-wait" role="status" title={waiting.map((s) => s.name || s.cwd.split('/').filter(Boolean).pop()).join(', ')}>
      <IconPause />
      <span>{tr(`재시작으로 멈춘 일 ${waiting.length}개 — ${josa(assistant(), '을', '를')} 켜면 이어서 맡아요`, `${waiting.length} paused by a restart — start ${assistant()} to pick them up`)}</span>
    </div>
  );
  const making = creating && !live.some((x) => x.name === creating) ? (
    <div className="oh-row st-making" aria-busy="true">
      <OrchAvatar name={creating} size={36} state="rest" color={colorOf(creating)} label={nameOf({ id: '', name: creating })} />
      <span className="oh-txt"><span className="oh-l1"><b>{nameOf({ id: '', name: creating }) || creating}</b><span className="cv-spin" /></span><span className="oh-l2">{tr('만드는 중…', 'Creating…')}</span></span>
    </div>
  ) : null;
  return (
    <div className="cv-dash oh">
      <header className="cv-page-head">
        <div className="cv-titles"><h1>{tr('오케스트레이터', 'Orchestrators')}</h1></div>
        {onNew && !empty && <button className="oh-new" onClick={onNew} aria-label={tr(`새 ${assistant()}`, `New ${assistant()}`)} title={tr(`새 ${assistant()} (⌘T)`, `New ${assistant()} (⌘T)`)}><IconPlus /></button>}
      </header>
      {empty ? (
        <div className="oh-empty">
          <div className="oh-empty-in">
            <BrandMark size={88} />
            {onNew && <button className="btn pri oh-big" onClick={onNew}>{tr(`새 ${assistant()} 만들기`, `Create a new ${assistant()}`)}</button>}
            {wait}
          </div>
        </div>
      ) : (
        <div className="oh-body">
          {wait}
          {(rows.live.length > 0 || making) && <section className="oh-list" aria-label={tr('켜져 있음', 'Running')}>{making}{rows.live.map(row)}</section>}
          {rows.off.length > 0 && (
            <section className="oh-list" aria-label={tr('꺼져 있음', 'Stopped')}>
              <div className="cv-h2">{tr('꺼져 있음', 'Stopped')}<span>{rows.off.length}</span></div>
              {rows.off.map(row)}
            </section>
          )}
        </div>
      )}
    </div>
  );
}
