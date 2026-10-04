import { invoke } from '@tauri-apps/api/core';
import { useState } from 'react';
import { kindView, needsAnswer, type DirectCard } from '../../domain/directAsk';
import { josa, tr } from '../../i18n';
import { openAgentModal } from '../AgentBrowserModal';
import './directCard.css';

type Pick = { pick: 'yes' } | { pick: 'no' } | { pick: 'option'; option: number } | { pick: 'text'; text: string };

/** 그 세션이 무슨 일을 하는지 한 줄 — 세션이 쓴 설명, 없으면 프로젝트 */
const whatOf = (c: DirectCard, project?: string) => c.what || tr(`${project || c.cwd.split('/').pop() || c.from} 일을 하는 세션`, `Session working on ${project || c.from}`);
const hhmm = (ts?: string) => (ts ? new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '');

/**
 * 직접 답하기 카드(2026-10-03, 시안 A '흐름 속 카드') — 누가(세션·한 줄 설명) / 무엇을(위험 말·금액) / 누르면 / 그냥 두면.
 * 누르면 앱이 그 세션 입력칸에 사람 말로 친다(Rust direct_answer — 진짜 클릭에서만 부른다). 직접 답은 접어 둔다
 */
export type DirectPick = Pick;
const desktopAnswer = (id: string, pick: Pick) => invoke<void>('direct_answer', { id, pick });

export function DirectCardView({ c, name, project, profile, compact, onOpen, onAnswer = desktopAnswer }: { c: DirectCard; name: string; project?: string; profile?: string; compact?: boolean; onOpen?: () => void; /** 폰은 폰 서버 길(/api/direct-answer) */ onAnswer?: (id: string, pick: Pick) => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [free, setFree] = useState<string | null>(null);
  const k = kindView(c.kind);
  const answer = (e: React.MouseEvent, pick: Pick) => {
    if (!e.isTrusted || busy) return; // 사람 클릭만 — 스크립트가 만든 클릭은 무시
    setBusy(true);
    setErr('');
    void onAnswer(c.id, pick).then(() => setFree(null), (x) => setErr(x instanceof Error ? x.message : String(x))).finally(() => setBusy(false));
  };
  const badge = <span className={`dc-risk dc-${k.tone}`}>{c.amount ? `${k.word} ${c.amount}` : k.word}</span>;
  const who = <span className="dc-av" aria-hidden="true">{(name || '?').slice(0, 1)}</span>;

  if (!needsAnswer(c)) {
    // 답한 뒤·끝난 카드 — 한 줄 영수증
    const step = (on: boolean, t: string) => <span className={on ? 'on' : ''}><i />{t}</span>;
    const order = { sent: 1, got: 2, done: 3 } as Record<string, number>;
    const n = order[c.state] ?? 0;
    return (
      <div className="dc-done" role="group" aria-label={tr('직접 답 영수증', 'Direct answer receipt')}>
        <div className="dc-line">{who}<b>{name}</b><span className="dc-muted">· {k.word}{c.amount ? ` ${c.amount}` : ''}</span>
          <span className="dc-end">{c.answer ? `${c.answer.label ?? tr('직접 답', 'Answered')} · ${hhmm(c.answer.ts)}` : c.state === 'gone' ? tr('세션이 꺼졌어요', 'Session ended') : c.state === 'closed' ? tr('세션이 거둬들였어요', 'Withdrawn') : c.state === 'done' ? tr('세션이 답 없이 끝냈어요', 'Closed by the session') : tr('지난 질문', 'Replaced')}</span>
        </div>
        {n > 0 && c.answer && <div className="dc-steps">{step(n >= 1, tr('보냄', 'Sent'))}<em>—</em>{step(n >= 2, tr('세션이 받았음', 'Received'))}<em>—</em>{step(n >= 3, c.note ? `${tr('처리됨', 'Done')} · ${c.note}` : tr('처리됨', 'Done'))}</div>}
      </div>
    );
  }
  if (compact) {
    return (
      <div className="dc-mini">{who}<div className="dc-t"><b>{name}</b> {badge}<div className="dc-muted">{c.q}</div></div><button className="dc-link" onClick={onOpen}>{tr('열기', 'Open')}</button></div>
    );
  }
  const danger = k.tone === 'danger';
  return (
    <div className={`dc-card ${danger ? 'dc-hot' : ''}`} role="group" aria-label={tr(`${josa(name, '이', '가')} 네 답을 기다려`, `${name} needs your answer`)}>
      <div className="dc-top">
        <div className="dc-who">{who}<div><b>{name}</b><div className="dc-what">{whatOf(c, project)}</div></div></div>
        <span className={`dc-risk dc-${k.tone}`}>{k.word}</span>
      </div>
      <div>
        {c.amount && <div className="dc-amount">{c.amount}</div>}
        <div className={c.amount ? 'dc-muted' : 'dc-q'}>{c.amount ? [c.q, c.detail].filter(Boolean).join(' · ') : c.q}</div>
        {!c.amount && c.detail && <div className="dc-muted">{c.detail}</div>}
      </div>
      {c.kind === 'login' ? (
        <dl className="dc-if"><dt>{tr('하는 법', 'How')}</dt><dd>{tr('크게 보기에서 직접 로그인하고, 끝나면 다 했어', 'Sign in yourself in the big view, then press Done')}</dd><dt>{tr('그냥 두면', 'If you wait')}</dt><dd>{tr('세션은 여기서 기다려요', 'The session waits here')}</dd></dl>
      ) : (
        <dl className="dc-if"><dt>{c.yes}</dt><dd>{tr('누르면 이 세션에 네 답으로 바로 전해요 — 세션이 이어서 해요', 'Sends your answer to this session — it carries on')}</dd><dt>{c.no}</dt><dd>{tr('하지 말라고 전해요', 'Tells it not to')}</dd><dt>{tr('그냥 두면', 'If you wait')}</dt><dd>{tr('세션은 여기서 기다려요 — 다른 일은 그대로 돌아요', 'The session waits — other work goes on')}</dd></dl>
      )}
      {c.options.length > 0 && (
        <div className="dc-opts">{c.options.map((o, i) => <button key={i} className="dc-btn dc-no" disabled={busy} onClick={(e) => answer(e, { pick: 'option', option: i })}>{o}</button>)}</div>
      )}
      <div className="dc-acts">
        {free === null && <button className="dc-link dc-free" onClick={() => setFree('')}>{tr('직접 답 쓰기', 'Write an answer')}</button>}
        {c.kind === 'login' && profile && <button className="dc-btn dc-no" onClick={() => openAgentModal(profile)}>{tr('크게 보기로 하기', 'Open big view')}</button>}
        {c.kind === 'login' && !profile && <span className="dc-muted">{tr('로그인은 맥 앱 크게 보기에서', 'Sign in from the Mac app big view')}</span>}
        <button className="dc-btn dc-no" disabled={busy} onClick={(e) => answer(e, { pick: 'no' })}>{c.no}</button>
        <button className={`dc-btn dc-go ${danger ? 'dc-pay' : ''}`} disabled={busy} onClick={(e) => answer(e, { pick: 'yes' })}>{c.yes}</button>
      </div>
      {free !== null && (
        <div className="dc-freebox">
          <textarea value={free} onChange={(e) => setFree(e.target.value)} rows={2} placeholder={tr('예: 카드 말고 다음 주에 계좌로 다시 해 줘', 'e.g. Not by card — do it by bank transfer next week')} aria-label={tr('직접 답', 'Your answer')} />
          <div className="dc-muted">{tr(`이 글은 ${name} 입력칸에 네가 친 말로 들어가요`, `This goes into ${name}'s input as your own words`)}</div>
          <div className="dc-acts"><button className="dc-btn dc-no" onClick={() => setFree(null)}>{tr('접기', 'Close')}</button><button className="dc-btn dc-go" disabled={busy || !free.trim()} onClick={(e) => answer(e, { pick: 'text', text: free })}>{tr(`${name}에 보내기`, `Send to ${name}`)}</button></div>
        </div>
      )}
      {(err || c.state === 'failed') && <div className="dc-err" role="alert">{err || tr('못 보냈어요 — 다시 눌러 주세요', 'Not sent — press again')}</div>}
    </div>
  );
}
