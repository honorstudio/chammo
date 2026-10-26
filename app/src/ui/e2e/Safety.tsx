// 보안 번호 받아들이기(시안 docs/design-drafts/e2e-safety v1, chammo-relay ADR 0007 결정 2·5) — 결정 대기함 카드 몸통·번호 판·멤버 줄 패널.
// 받아들이기·막아 두기는 카드 답(direct_answer — 메인 창·짝지은 폰)으로만. '같아요'(확인됨)·카드 다시 띄우기는 메신저 창 명령
import { useState } from 'react';
import { e2eSafetyRefetch, e2eSafetyUnblock, e2eSafetyVerify, safetyAnswer } from '../../data/teamApi';
import type { DirectCard } from '../../domain/directAsk';
import { needsRefetch, safetyGroups, safetyLabel, type SafetyPerson } from '../../domain/e2eSafety';
import { tr } from '../../i18n';
import '../chat/directCard.css';
import './e2e.css';

/** 번호 판 — 'OO와 나의 보안 번호 · 팀' + 5자리 여섯 묶음 */
export function SafetyNumber({ code, who, team }: { code: string; who: string; team?: string }) {
  const g = safetyGroups(code);
  if (!g.length) return <div className="dc-muted">{tr('보안 번호를 아직 못 셈했어요 — 잠시 뒤 다시', "Can't compute the safety number yet — try again shortly")}</div>;
  return (
    <>
      <div className="sn-who"><span>{tr(`${who}와 나의 보안 번호`, `Safety number with ${who}`)}</span>{team && <span>{team}</span>}</div>
      <div className="sn" aria-label={tr(`보안 번호 ${code}`, `Safety number ${code}`)}>{g.map((x, i) => <span key={i}>{x}</span>)}</div>
    </>
  );
}

/** 결정 대기함 보안 번호 카드 몸통 — 처음엔 무엇이 일어나는지, '번호 비교'를 연 뒤에야 받아들이기가 켜진다 */
export function SafetyCardBody({ c, busy, answer }: { c: DirectCard; busy: boolean; answer: (e: React.MouseEvent, yes: boolean) => void }) {
  const [compare, setCompare] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [ferr, setFerr] = useState<string | null>(null);
  // 갈림 — 먼저 '다시 받기'(서버에서 새로 받아 그 사슬 번호로 카드를 다시 띄운다). 폰 웹엔 이 명령이 없어 안내만
  const refetch = (e: React.MouseEvent) => {
    if (!e.isTrusted || fetching || !c.acct) return;
    setFetching(true);
    setFerr(null);
    void e2eSafetyRefetch(c.acct).catch((x: unknown) => setFerr(String(x))).finally(() => setFetching(false));
  };
  const who = c.who || '?';
  const team = c.detail?.split(' · ')[0];
  if (compare) {
    return (
      <>
        <SafetyNumber code={c.code ?? ''} who={who} team={team} />
        <div className="dc-muted" style={{ textAlign: 'center' }}>{tr(`${who} 화면의 번호와 같은지 만나서나 전화로 견줘요`, `Compare it with ${who}'s screen in person or on a call`)}</div>
        <div className="dc-acts">
          <button className="dc-btn dc-no" disabled={busy} onClick={(e) => answer(e, false)}>{c.no}</button>
          <button className="dc-btn dc-go" disabled={busy || !c.code} onClick={(e) => answer(e, true)}>{tr('같아요 · 받아들이기', 'Same · Accept')}</button>
        </div>
      </>
    );
  }
  return (
    <>
      {c.safety === 'forked' ? (
        <dl className="dc-if"><dt>{c.yes}</dt><dd>{tr(`번호를 ${who}와 직접 견준 뒤에만`, `Only after comparing the number with ${who}`)}</dd><dt>{c.no}</dt><dd>{tr(`${who}에게 가는 말은 멈춰 있어요`, `Messages to ${who} stay paused`)}</dd></dl>
      ) : (
        <dl className="dc-if"><dt>{c.yes}</dt><dd>{tr(`새 번호를 믿고 ${who}에게 다시 보내요 — ${who} 화면의 번호와 같을 때만`, `Trust the new number and send to ${who} again — only if it matches ${who}'s screen`)}</dd><dt>{c.no}</dt><dd>{tr(`${who}에게 가는 말은 계속 멈춰 있어요`, `Messages to ${who} stay paused`)}</dd><dt>{tr('그냥 두면', 'If you wait')}</dt><dd>{tr('멈춘 채로 기다려요(참모 말도 안 나가요)', 'They wait paused (assistant messages too)')}</dd></dl>
      )}
      <div className="dc-acts">
        {needsRefetch(c)
          ? <button className="dc-link dc-free" disabled={fetching} onClick={refetch}>{tr('다시 받기', 'Fetch again')}</button>
          : <button className="dc-link dc-free" onClick={() => setCompare(true)}>{tr('번호 비교', 'Compare numbers')}</button>}
        <button className="dc-btn dc-no" disabled={busy} onClick={(e) => answer(e, false)}>{c.no}</button>
        <button className="dc-btn dc-go" disabled title={needsRefetch(c) ? tr('먼저 다시 받아요', 'Fetch again first') : tr('번호를 먼저 견줘요', 'Compare the number first')}>{c.yes}</button>
      </div>
      {needsRefetch(c) && <div className="dc-muted">{tr('갈림은 사슬을 서버에서 다시 받은 뒤 그 번호를 견줘야 받아들일 수 있어요 — 컴퓨터 앱에서', 'For a split list, fetch the chain again and compare that number before accepting — in the desktop app')}</div>}
      {ferr && <div className="dc-err" role="alert">{ferr}</div>}
    </>
  );
}

/** 멤버 줄 상태 — 초록 점은 확인됨일 때만 */
export function SafetyState({ p }: { p: SafetyPerson }) {
  const l = safetyLabel(p);
  return <span className={`sn-state${l.ok ? ' ok' : ''}`}>{l.ok && <i className="ok-dot" aria-hidden />}{l.text}</span>;
}

/** 번호 보기 패널(팀 설정 멤버 줄·대화 '확인') — 안 견준 사람은 '같아요', 바뀐 사람은 카드 답 문으로 받아들이기·막아 두기, 막아 뒀으면 카드 다시 띄우기 */
export function SafetyPanel({ p, teamName, onDone, readOnly }: { p: SafetyPerson; teamName?: string; onDone: () => void;
  /** 폰 웹 — 메신저 창 명령이 없다. 번호만 보여 주고 받아들이기는 폰 결정 대기함 카드로 */ readOnly?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const run = (e: React.MouseEvent, go: () => Promise<void>) => {
    if (!e.isTrusted || busy) return; // 사람 클릭만
    setBusy(true);
    setErr(null);
    void go().then(onDone, (x: unknown) => setErr(String(x))).finally(() => setBusy(false));
  };
  const changed = p.state === 'changed' || p.state === 'forked';
  return (
    <div className="sn-panel" role="group" aria-label={tr(`${p.name} 보안 번호`, `${p.name} safety number`)}>
      <SafetyNumber code={p.number} who={p.name} team={teamName} />
      <div className="dc-muted" style={{ textAlign: 'center' }}>{tr(`${p.name} 화면의 번호와 같은지 만나서나 전화로 견줘요`, `Compare it with ${p.name}'s screen in person or on a call`)}</div>
      {readOnly ? <div className="dc-muted" style={{ textAlign: 'center' }}>{changed ? tr('받아들이기·막아 두기는 결정 대기함 카드에서 해요', 'Accept or block from the card in your inbox') : tr('같다고 표시하는 건 컴퓨터 앱 팀 설정에서 해요', 'Mark it as the same in the desktop app team settings')}</div> : (
      <div className="dc-acts">
        {!changed && <button className="dc-btn dc-go" disabled={busy} onClick={(e) => run(e, () => e2eSafetyVerify(p.account))}>{p.state === 'verified' ? tr('다시 견줬어요', 'Compared again') : tr('같아요', 'Same')}</button>}
        {changed && p.blocked && <button className="dc-btn dc-no" disabled={busy} onClick={(e) => run(e, () => e2eSafetyUnblock(p.account))}>{tr('카드 다시 띄우기', 'Show the card again')}</button>}
        {changed && !p.blocked && needsRefetch(p) && <button className="dc-btn dc-no" disabled={busy} onClick={(e) => run(e, () => e2eSafetyRefetch(p.account))}>{tr('다시 받기', 'Fetch again')}</button>}
        {changed && !p.blocked && p.card && !needsRefetch(p) && (
          <>
            <button className="dc-btn dc-no" disabled={busy} onClick={(e) => run(e, () => safetyAnswer(p.card, false))}>{tr('막아 두기', 'Keep blocked')}</button>
            <button className="dc-btn dc-go" disabled={busy} onClick={(e) => run(e, () => safetyAnswer(p.card, true))}>{tr('같아요 · 받아들이기', 'Same · Accept')}</button>
          </>
        )}
        {changed && !p.blocked && !p.card && <span className="dc-muted">{tr('결정 대기함에 카드가 곧 떠요', 'A card will appear in your inbox shortly')}</span>}
      </div>
      )}
      {err && <div className="dc-err" role="alert">{err}</div>}
    </div>
  );
}
