// 팀 설정 — 메신저 머리 설정 단추·팀 보관함 머리 설정 단추·팀 아이콘 메뉴(데스크톱 띠 팝업·메신저 창 목록 칸). 판단은 domain/teamSettings
// 시안 team-settings v1 A(한 장): 팀 아이콘·이름 → 팀원(머리에 '초대 링크', 줄 끝 '더보기' 메뉴, 내 줄 = 내 프로필) → 요금제 빈 자리 → 따라가기 → 나가기·지우기
// 나가기·빼기는 되돌리기 어려워 확인 창(Confirm)을 한 번 더 — 서버 길은 chammo-relay membership.ts(마지막 팀장은 409)
import { useContext, useEffect, useRef, useState } from 'react';
import { teamDelete, teamFeed, teamInvite, teamInvites, teamLeave, teamMakeOwner, teamRemove, teamRename, teamRevokeInvites, type OpenInvite, type TeamView } from '../../data/teamApi';
import { teamIconSet } from '../../data/teamProfileApi';
import type { SafetyPerson } from '../../domain/e2eSafety';
import { personColor } from '../../domain/teamChat';
import { lookOf, statusLine } from '../../domain/teamProfile';
import { canDeleteTeam, deleteAsk, leaveNote, memberRows, menuFor, switchTargets } from '../../domain/teamSettings';
import { tr } from '../../i18n';
import { IconClose, IconCopy, IconMore, IconPencil } from '../Icons';
import { IconButton } from '../kit/IconButton';
import { Confirm, ContextMenu, type MenuItem } from '../OrchDialogs';
import { SafetyPanel, SafetyState } from '../e2e/Safety';
import { atOf, MyProfileCard, TeamIconCard, usePick, type At } from './MyProfile';
import { Person, TeamMarkIcon } from './TeamFaces';
import { ProfilesCtx } from './useProfiles';
import { AgentsSection } from './TeamAgents';
import { TeamAgentEdit } from './TeamAgentEdit';
import type { AgentList, AgentShown } from '../../domain/teamAgent';
import './team.css';
import './profile.css';
import { seenName } from '../../domain/session';

type Ask = { kind: 'leave' } | { kind: 'delete' } | { kind: 'remove'; id: string; name: string } | { kind: 'owner'; id: string; name: string };

export function TeamSettings({ view: given, onClose, onChanged, follow }: {
  view: TeamView;
  onClose: () => void;
  onChanged: () => void;
  /** 스페이스 팀 탭이 메신저에서 고른 팀을 따라가기 — 메인 창에서만(따로 창엔 스페이스가 없다). 예전엔 팀 보관함 머리 고리 단추였다(284.png) */
  follow?: { on: boolean; set: (on: boolean) => void };
}) {
  const [fresh, setFresh] = useState<TeamView | null>(null);
  const view = fresh ?? given;
  // 이 설정이 열린 팀 — 지우기는 이 id 로만(지운 뒤 지금 팀이 다른 팀으로 바뀌어도 그 팀을 건드리지 않게, 1025 B')
  const target = useRef(given.teamId);
  const [gone, setGone] = useState(false);
  const owner = view.role === 'owner';
  const [name, setName] = useState(view.team);
  const [invites, setInvites] = useState<OpenInvite[] | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [ask, setAsk] = useState<Ask | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  useEffect(() => { if (owner) void teamInvites(view.teamId).then(setInvites, () => setInvites(null)); }, [owner, link, view.teamId]);
  // 보안 번호(시안 e2e-safety v1) — 멤버 줄 '확인됨'·번호 보기
  const [safety, setSafety] = useState<SafetyPerson[]>([]);
  const [numberOf, setNumberOf] = useState<string | null>(null);
  const loadSafety = () => void teamFeed(1).then((f) => setSafety(f.safety ?? []), () => {});
  useEffect(loadSafety, []);
  const { board, reload } = useContext(ProfilesCtx);
  const [showInvite, setShowInvite] = useState(false);
  const [more, setMore] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const [mine, setMine] = useState<At | null>(null);
  // 팀 참모 고치기(ADR 0017) — 같은 창이 두 칸으로 넓어진다(시안 design-v2 섞음 1). agentsKey 는 저장 뒤 목록 다시 받기
  const [agentEdit, setAgentEdit] = useState<{ a: AgentShown | null; list: AgentList } | null>(null);
  const [agentsKey, setAgentsKey] = useState(0);
  const [iconAt, setIconAt] = useState<At | null>(null);
  const [iconSrc, setIconSrc] = useState('');
  const iconBtn = useRef<HTMLButtonElement>(null);
  const pickIcon = usePick((src) => { setIconSrc(src); if (iconBtn.current) setIconAt(atOf(iconBtn.current)); });
  const run = <T,>(p: Promise<T>, then: (x: T) => void) => {
    setBusy(true);
    setErr(null);
    setNote(null);
    void p.then(then, (e: unknown) => setErr(String(e))).finally(() => setBusy(false));
  };
  const got = (v: TeamView) => { setFresh(v); onChanged(); };
  const rows = memberRows(view);
  const sp = (member: string) => safety.find((x) => x.team === view.teamId && x.member === member);
  const blocked = leaveNote(view) === 'last-owner';
  const confirm = ask && (
    ask.kind === 'leave' ? (
      <Confirm title={tr(`${view.team} 팀에서 나갈까요?`, `Leave ${view.team}?`)} body={tr('이 기기에서 팀 대화가 사라지고, 다시 들어오려면 새 초대가 필요해요.', 'Team chats leave this device; you need a new invite to come back.')}
        ok={tr('정말 나가기', 'Leave')} danger onCancel={() => setAsk(null)}
        onOk={() => { setAsk(null); run(teamLeave(view.teamId), (v) => { got(v); onClose(); }); }} />
    ) : ask.kind === 'delete' ? (
      <Confirm {...deleteAsk(view)}
        ok={tr('정말 지우기', 'Delete')} danger onCancel={() => setAsk(null)}
        onOk={() => {
          setAsk(null);
          // 지운 뒤엔 새 상태로 이 설정을 다시 그리지 않는다 — 바로 닫고 목록만 새로(지금 팀이 바뀐 설정에서 또 지우지 않게)
          run(teamDelete(target.current), () => { setGone(true); onChanged(); onClose(); });
        }} />
    ) : ask.kind === 'remove' ? (
      <Confirm title={tr(`${ask.name} 님을 팀에서 뺄까요?`, `Remove ${ask.name} from the team?`)} body={tr('그 사람의 기기에서 이 팀 대화가 끊겨요. 다시 들이려면 새 초대를 보내요.', 'Their devices lose this team chat. Send a new invite to bring them back.')}
        ok={tr('팀에서 빼기', 'Remove')} danger onCancel={() => setAsk(null)}
        onOk={() => { const id = ask.id; setAsk(null); run(teamRemove(view.teamId, id), got); }} />
    ) : (
      <Confirm title={tr(`${ask.name} 님을 팀장으로 바꿀까요?`, `Make ${ask.name} an owner?`)} body={tr('팀장은 여럿일 수 있어요. 팀장은 초대·이름 바꾸기·팀원 빼기를 할 수 있어요.', 'A team can have several owners. Owners can invite, rename and remove members.')}
        ok={tr('팀장으로 바꾸기', 'Make owner')} onCancel={() => setAsk(null)}
        onOk={() => { const id = ask.id; setAsk(null); run(teamMakeOwner(view.teamId, id), got); }} />
    )
  );
  const meRow = rows.find((r) => r.me);
  const myLook = lookOf(board, meRow?.id ?? '', view.me);
  const rowMenu = (r: (typeof rows)[number]): MenuItem[] => [
    ...(r.canRemove && !r.owner ? [{ label: tr('팀장으로', 'Make owner'), run: () => setAsk({ kind: 'owner', id: r.id, name: r.name }) }] : []),
    ...(sp(r.id) ? [{ label: tr('보안 번호 보기', 'View safety number'), run: () => setNumberOf(r.id) }] : []),
    ...(r.canRemove ? [{ label: tr('팀에서 빼기', 'Remove'), danger: true, run: () => setAsk({ kind: 'remove', id: r.id, name: r.name }) }] : []),
  ];
  if (agentEdit) {
    return (
      <div className="tmx-start tmx-set tma-wide">
        <TeamAgentEdit team={view.teamId} list={agentEdit.list} editing={agentEdit.a} people={view.members.map((m) => m.name)}
          rooms={view.rooms.filter((r) => (r.kind === 'group' || r.kind === 'dm') && (!r.team || r.team === view.teamId)).map((r) => ({ id: r.id, name: r.name || r.with }))}
          onBack={() => setAgentEdit(null)} onSaved={() => { setAgentEdit(null); setAgentsKey((k) => k + 1); }} />
      </div>
    );
  }
  return (
    <div className="tmx-start tmx-set">
      {pickIcon.input}
      <div className="tmx-set-h"><b>{tr('팀 설정', 'Team settings')}</b><IconButton label={tr('닫기', 'Close')} onClick={onClose}><IconClose /></IconButton></div>

      <div className="tmp-head">
        <button ref={iconBtn} className="tmp-iconbtn" disabled={!owner || busy} onClick={pickIcon.open}
          aria-label={owner ? tr('팀 아이콘 바꾸기', 'Change team icon') : view.team} title={owner ? tr('팀 아이콘 바꾸기', 'Change team icon') : undefined}>
          <TeamMarkIcon name={view.team} size={40} img={board?.teamIcon || undefined} />
          {owner && <span className="tmp-pen" aria-hidden="true"><IconPencil /></span>}
        </button>
        {owner ? (
          <>
            <input value={name} onChange={(e) => setName(e.target.value)} aria-label={tr('팀 이름', 'Team name')}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing && !busy && name.trim() && name.trim() !== view.team) run(teamRename(view.teamId, name), got); }} />
            {name.trim() !== view.team && <button className="tmx-btn tmx-sm" disabled={busy || !name.trim()} onClick={() => run(teamRename(view.teamId, name), got)}>{busy ? tr('저장 중', 'Saving') : tr('저장', 'Save')}</button>}
          </>
        ) : <b className="tmx-set-v">{view.team}</b>}
      </div>
      {owner && board?.teamIcon && <div><button className="tmx-btn tmx-sm" disabled={busy} onClick={() => run(teamIconSet(view.teamId, ''), () => reload())}>{tr('팀 아이콘 지우기', 'Remove team icon')}</button></div>}

      <AgentsSection key={agentsKey} team={view.teamId} onEdit={(a, list) => setAgentEdit({ a, list })} />

      <div className="tmp-sec">
        <span className="tmx-fl">{tr(`팀원 ${rows.length}`, `${rows.length} members`)}</span>
        {owner && <button className="tmx-btn tmx-sm" aria-expanded={showInvite} onClick={() => setShowInvite((x) => !x)}>{tr('초대 링크', 'Invite link')}</button>}
      </div>
      {owner && showInvite && (
        <>
          {link ? (
            <div className="tmx-lnk"><code>{link}</code>
              <IconButton label={copied ? tr('복사했어요', 'Copied') : tr('복사', 'Copy')} onClick={() => void navigator.clipboard?.writeText(link).then(() => setCopied(true), () => {})}><IconCopy /></IconButton>
            </div>
          ) : <div className="tmx-row-a tmx-row-l"><button className="tmx-btn pri tmx-sm" disabled={busy} onClick={() => run(teamInvite(), (l) => { setLink(l.link); setCopied(false); })}>{tr('초대 링크 만들기', 'Make an invite link')}</button></div>}
          <span className="tmx-hint">{tr('슬랙·카톡으로 보내면 받는 사람이 눌러서 들어와요 · 24시간 · 한 사람만', 'Send it over Slack or chat — they click it to join · 24 hours · one person')}</span>
          {invites !== null && invites.length > 0 && (
            <div className="tmx-set-row">
              <span className="tmx-hint">{tr(`아직 안 쓴 초대 ${invites.length}개`, `${invites.length} unused invites`)}</span>
              <button className="tmx-btn tmx-sm" disabled={busy} onClick={() => run(teamRevokeInvites(view.teamId), (n) => { setLink(null); setInvites([]); setNote(tr(`초대 ${n}개를 막았어요 — 보낸 링크로는 이제 못 들어와요`, `Revoked ${n} — those links no longer work`)); })}>{tr('안 쓴 초대 막기', 'Revoke unused invites')}</button>
            </div>
          )}
        </>
      )}
      <ul className="tmx-set-ppl tmp-ppl">
        {rows.map((r) => {
          const l = lookOf(board, r.id, r.name);
          const sub = statusLine(l) || [r.devices.join(' · '), r.me && view.deliverTo ? tr(`받는 참모 ${seenName(view.deliverTo)}`, `assistant ${seenName(view.deliverTo)}`) : ''].filter(Boolean).join(' · ');
          const items = rowMenu(r);
          const who = (
            <>
              <b>{l.name}{r.me && <span className="tmx-tag">{tr('나', 'me')}</span>}{r.owner && <span className="tmx-tag">{tr('팀장', 'owner')}</span>}{sp(r.id) && <SafetyState p={sp(r.id)!} />}</b>
              {sub && <span>{sub}</span>}
            </>
          );
          return (
            <li key={r.id} className={r.me ? 'me' : undefined}>
              <Person name={l.name} color={personColor(r.name)} size={30} photo={l.photo} status={l.status} />
              {r.me
                ? <button className="tmp-who" aria-haspopup="dialog" aria-label={tr(`내 프로필 — ${statusLine(l) || '상태 정하기'}`, `My profile — ${statusLine(l) || 'set a status'}`)} onClick={(e) => setMine(atOf(e.currentTarget))}>{who}</button>
                : <span className="tmp-who">{who}</span>}
              {items.length > 0 && (
                <IconButton className="tmp-more" label={tr(`${l.name} 더보기`, `More for ${l.name}`)} aria-haspopup="menu"
                  onClick={(e) => { const b = e.currentTarget.getBoundingClientRect(); setMore({ x: Math.round(b.left), y: Math.round(b.bottom + 4), items }); }}><IconMore /></IconButton>
              )}
            </li>
          );
        })}
      </ul>
      {numberOf && sp(numberOf) && <SafetyPanel p={sp(numberOf)!} teamName={view.team} onDone={() => { setNumberOf(null); loadSafety(); }} />}
      {!owner && <span className="tmx-hint">{tr('초대 링크는 팀장이 만들어요', 'Only a team owner can make invite links')}</span>}

      <span className="tmx-fl">{tr('요금제 · 사용량', 'Plan · usage')}</span>
      <div className="tmp-slot">{tr('곧 들어와요', 'Coming soon')}</div>

      {follow && (
        <label className="tmp-sw"><span>{tr('스페이스 팀 탭이 메신저에서 고른 팀을 따라가기', 'Space team tab follows the team picked in the messenger')}</span>
          <input type="checkbox" role="switch" checked={follow.on} onChange={(e) => follow.set(e.target.checked)} /></label>
      )}

      <div className="tmp-sep" />
      {blocked && <span className="tmx-hint">{rows.length > 1 ? tr('마지막 팀장이라 지금은 못 나가요 — 다른 사람을 먼저 팀장으로 바꿔 주세요', "You're the last owner — make someone else an owner first") : tr('팀에 나 혼자라 나갈 수 없어요', "You're the only one in this team")}</span>}
      <div className="tmx-row-a tmx-row-l">
        {!blocked && <button className="tmx-btn danger" disabled={busy} onClick={() => setAsk({ kind: 'leave' })}>{tr('팀 나가기', 'Leave team')}</button>}
        {canDeleteTeam(view) && !gone && view.teamId === target.current && <button className="tmx-btn danger" disabled={busy} onClick={() => setAsk({ kind: 'delete' })}>{tr('팀 지우기', 'Delete team')}</button>}
      </div>

      {note && <span className="tmx-hint" role="status">{note}</span>}
      {err && <span className="tmx-hint" role="alert">{err}</span>}
      {confirm}
      {more && <ContextMenu x={more.x} y={more.y} items={more.items} onClose={() => setMore(null)} />}
      {mine && <MyProfileCard me={myLook} rosterName={view.me} sub={`${view.team} · ${owner ? tr('팀장', 'owner') : tr('팀원', 'member')}`} at={mine} onClose={() => setMine(null)} onSaved={reload} />}
      {iconAt && iconSrc && <TeamIconCard src={iconSrc} at={iconAt} onClose={() => { setIconAt(null); setIconSrc(''); }} onPicked={(d) => run(teamIconSet(view.teamId, d), () => reload())} />}
    </div>
  );
}

/** 팀 아이콘 메뉴(왼쪽·오른쪽 누르기) — 메신저 창과 데스크톱 띠가 같은 줄. 팀이 둘 이상이면 끝에 '○○ 팀으로 바꾸기'(QA 6) */
export function teamMenu(view: { joined: boolean; teamId?: string; teams?: { id: string; name: string }[] } | null, go: (p: 'start' | 'link' | 'settings') => void, switchTo?: (team: string) => void): MenuItem[] {
  const base: MenuItem[] = menuFor(view).map((k) => (k === 'invite' ? { label: tr('팀 초대', 'Invite to team'), run: () => go('link') } : k === 'settings' ? { label: tr('팀 설정', 'Team settings'), run: () => go('settings') } : { label: tr('팀 만들기', 'Make a team'), run: () => go('start') }));
  const others = view?.joined && switchTo ? switchTargets({ teamId: view.teamId ?? '', teams: view.teams }) : [];
  return [...base, ...others.map((t) => ({ label: tr(`${t.label} 팀으로 바꾸기`, `Switch to ${t.label}`), run: () => switchTo!(t.id) }))];
}
