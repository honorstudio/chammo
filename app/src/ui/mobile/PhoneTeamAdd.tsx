// 폰 팀 머리 — 내 팀 가로 줄 + 끝에 +(시안 team-add v1 B2: 데스크톱 레일을 눕힌 모양, 11-02 사용자 확정).
// 다른 팀 표를 누르면 그 팀으로 바뀌고, + 는 두 줄 시트(새 팀 만들기 / 초대 링크로 들어가기) → 같은 시트 안에서 칸.
// 지금 팀 이름 줄(꺾쇠)은 그 팀 시트(팀 참모·초대 링크)
import { useState } from 'react';
import type { TeamPhoneApi } from '../../data/web';
import type { TeamView } from '../../data/teamApi';
import { teamMark } from '../../domain/teamChat';
import { defaultMe, sameTeamName } from '../../domain/teamAdd';
import { contactOf, createLock, planErr, type CreateLock } from '../../domain/teamLock';
import { lockText } from '../team/TeamLock';
import { tr } from '../../i18n';
import { IconBack, IconCopy, IconShare } from '../Icons';
import { TeamMarkIcon } from '../team/TeamFaces';
import { BottomSheet } from './BottomSheet';
import { IconBtn } from './kit';

type Stacked = { id: string; name: string; current: boolean };

export function PhoneTeamStrip({ stack, icon, color, unreadOf, onPick, onCurrent }: {
  stack: Stacked[]; icon?: string; color?: string; unreadOf: (id: string) => number;
  onPick: (id: string) => void; onCurrent: () => void;
}) {
  return (
    <div className="m-team-strip">
      {stack.map((t) => {
        const n = unreadOf(t.id);
        return (
          <button key={t.id} className={`m-team-mk ${t.current ? 'on' : ''}`} aria-current={t.current || undefined}
            aria-label={n ? tr(`${t.name} — 안 읽은 말 ${n}`, `${t.name} — ${n} unread`) : t.name}
            style={{ '--rail-on': (t.current && color) || teamMark(t.name).color } as React.CSSProperties}
            onClick={() => (t.current ? onCurrent() : onPick(t.id))}>
            <TeamMarkIcon name={t.name} size={36} badge={n} img={t.current ? icon : undefined} />
          </button>
        );
      })}
    </div>
  );
}

type Step = 'menu' | 'make' | 'join';
const errText = (e: unknown) => String((e as Error)?.message ?? e).slice(0, 200);

/** + 시트 — 두 줄 → 만들기(팀 이름·내 이름) / 들어가기(초대 링크·내 이름). 만들면 초대 링크 + 나중에 보내기 */
export function TeamAddSheet({ api, view, onClose, onChanged }: { api: TeamPhoneApi; view: TeamView | null; onClose: () => void; onChanged: () => void }) {
  const [step, setStep] = useState<Step>('menu');
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [meIn, setMe] = useState<string | null>(null);
  const me = meIn ?? defaultMe(view);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<{ msg: string; raw: string } | null>(null);
  /** 만들기를 서버가 402 로 거절함 — 오류 줄 대신 문의 칸(chammo-relay ADR 0015) */
  const [lockErr, setLockErr] = useState<CreateLock | null>(null);
  const [made, setMade] = useState('');
  const [link, setLink] = useState('');
  const [copied, setCopied] = useState(false);
  const dup = step === 'make' && !made && sameTeamName(name, view?.teams);
  const fail = (msg: string) => (e: unknown) => setErr({ msg, raw: errText(e) });
  const go = (p: Promise<unknown>) => { setBusy(true); setErr(null); void p.finally(() => setBusy(false)); };
  const make = () => {
    const n = name.trim();
    go(api.create(name, me).then(() => {
      setMade(n);
      onChanged();
      return api.invite().then((l) => setLink(l.link), fail(tr('초대 링크를 못 만들었어요', "Couldn't make the invite link")));
    }, (e: unknown) => {
      const l = planErr(errText(e));
      if (l) setLockErr(l);
      else fail(tr('팀을 만들지 못했어요. 잠시 뒤에 다시 해 주세요.', "Couldn't create the team. Please try again in a moment."))(e);
    }));
  };
  const join = () => go(api.join(code, me).then(() => { onChanged(); onClose(); },
    fail(tr('들어가지 못했어요. 링크가 만료됐거나 이미 사용됐어요.', "Couldn't join. The link has expired or was already used."))));
  const meBox = (
    <>
      <span className="m-ts-sec">{tr('이 팀에서 보일 내 이름', 'Your name in this team')}</span>
      <div className="m-ts-make"><input value={me} onChange={(e) => setMe(e.target.value)} maxLength={40} aria-label={tr('이 팀에서 보일 내 이름', 'Your name in this team')} /></div>
    </>
  );
  const back = <IconBtn label={tr('뒤로', 'Back')} onClick={() => { setStep('menu'); setErr(null); setLockErr(null); }}><IconBack /></IconBtn>;
  // 새 팀은 권한 받은 계정만 — 같은 시트가 문의 칸으로(시안 team-lock v1 A2). 들어가기는 그대로
  const lock = step === 'make' && !made ? (lockErr ?? createLock(view?.plan)) : null;
  const lt = lock && lockText(lock);
  const title = lt ? lt.title : made ? tr(`${made} 팀을 만들었어요`, `${made} is ready`) : step === 'make' ? tr('새 팀 만들기', 'Create a team') : step === 'join' ? tr('초대 링크로 들어가기', 'Join with an invite link') : tr('팀 추가', 'Add a team');
  return (
    <BottomSheet label={title} title={title} onClose={onClose}>
      <div className="m-team-sheet">
        {step === 'menu' && <>
          <button className="m-ts-act" onClick={() => setStep('make')}>{tr('새 팀 만들기', 'Create a team')}</button>
          <button className="m-ts-act" onClick={() => setStep('join')}>{tr('초대 링크로 들어가기', 'Join with an invite link')}</button>
        </>}
        {lock && lt && <>
          <div className="m-ts-head">{back}</div>
          <p className="m-tl-body">{lt.body}</p>
          <a className="tmx-btn pri m-ts-go m-tl-go" href={contactOf(view?.plan)} target="_blank" rel="noopener noreferrer">{tr('문의하기', 'Contact us')}</a>
          {lock.kind !== 'expired' && <button className="tmx-btn m-ts-go m-tl-ghost" onClick={() => { setLockErr(null); setStep('join'); }}>{tr('초대 링크로 들어가기', 'Join with an invite link')}</button>}
        </>}
        {step === 'make' && !made && !lock && <>
          <div className="m-ts-head">{back}</div>
          <span className="m-ts-sec">{tr('팀 이름', 'Team name')}</span>
          <div className="m-ts-make"><input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} aria-label={tr('팀 이름', 'Team name')} autoFocus /></div>
          {dup && <span className="tmx-hint" role="status">{tr('같은 이름의 팀이 이미 있어요.', 'You already have a team with this name.')}</span>}
          {meBox}
          <span className="tmx-hint">{tr('팀마다 다르게 정할 수 있어요.', 'You can use a different name in each team.')}</span>
          <button className="tmx-btn pri m-ts-go" disabled={busy || !name.trim()} onClick={make}>{tr('만들기', 'Create')}</button>
        </>}
        {made && <>
          {link && (
            <div className="tmx-lnk"><code>{link}</code>
              <IconBtn label={copied ? tr('복사했어요', 'Copied') : tr('복사', 'Copy')} onClick={() => void navigator.clipboard?.writeText(link).then(() => setCopied(true), () => {})}><IconCopy /></IconBtn>
              {'share' in navigator && <IconBtn label={tr('공유', 'Share')} onClick={() => void navigator.share({ text: link }).catch(() => {})}><IconShare /></IconBtn>}
            </div>
          )}
          {link && <span className="tmx-hint">{tr('이 링크를 보내면 한 분이 24시간 안에 들어올 수 있어요.', 'Send this link and one person can join within 24 hours.')}</span>}
          <button className="tmx-btn m-ts-go" onClick={onClose}>{tr('나중에 보내기', 'Send later')}</button>
        </>}
        {step === 'join' && <>
          <div className="m-ts-head">{back}</div>
          <span className="m-ts-sec">{tr('초대 링크', 'Invite link')}</span>
          <div className="m-ts-make"><input value={code} onChange={(e) => setCode(e.target.value)} placeholder="https://chammo.app/join#…" aria-label={tr('초대 링크', 'Invite link')} autoFocus /></div>
          {meBox}
          <button className="tmx-btn pri m-ts-go" disabled={busy || !code.trim()} onClick={join}>{tr('들어가기', 'Join')}</button>
        </>}
        {err && <span className="tmx-hint" role="alert" title={err.raw}>{err.msg}</span>}
      </div>
    </BottomSheet>
  );
}
