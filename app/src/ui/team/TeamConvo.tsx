// 메신저 대화 칸 — 앱 안 가운데 칸·메신저 따로 창·대화 하나 창이 같이 쓴다(시안 v2).
// 모양: 풍선 = 사람(내 말은 오른쪽), 얼굴 + 맨 글 = 참모(남의 참모는 '하린의 참모' 꼬리표). 남의 말 위에 올리면 '내 참모에게' → 카드로 넘긴다.
// 보내기는 사람 말(team_human_say) — 이 칸 안의 진짜(isTrusted) 키·클릭 뒤 1.5초 안만(HUMAN_POSTS 와 같은 문, teamApi)
import { useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { teamFileAttach, teamFileOpen, teamFileSave, teamHumanSay, teamPickFiles, teamViewing, type HeldMsg, type SayExtra } from '../../data/teamApi';
import type { SafetyPerson } from '../../domain/e2eSafety';
import { SafetyPanel } from '../e2e/Safety';
import '../e2e/e2e.css';
import { atQuery, dayLabel, handoffText, lineOf, mentionList, mentionsMe, personColor, reactionsOf, roomItems, sayTarget, stamp, withMyReacts, type Convo, type MentionPick, type Reaction, type TeamFile, type TeamItem } from '../../domain/teamChat';
import { tr } from '../../i18n';
import { IconBack, IconChevronDown, IconChevronUp, IconClose, IconEnter, IconPencil, IconPlus, IconWindowOut } from '../Icons';
import { IconButton } from '../kit/IconButton';
import { ContextMenu, type MenuItem } from '../OrchDialogs';
import { openTeamFile } from './openTeamFile';
import { Face, PersonOf, TeamMarkIcon } from './TeamFaces';
import { dndNotice, lookOf, statusLine } from '../../domain/teamProfile';
import { ProfilesCtx } from './useProfiles';
import './profile.css';
import { Attachments, FileBubbles, HelperFace, MentionMenu, MentionText, ReactAdd, Reacts } from './RoomBits';
import { TEAM_DROP_EVENT } from './teamDrop';
import './team.css';

type Att = { key: string; name: string; size?: number; busy?: boolean; err?: string; ref?: TeamFile };

export type Handoff = { name: string; send: (text: string) => Promise<void> };

export function TeamConvo({ convo, items, team, myName, handed, onRead, onHanded, onSent, handoff, detach, focused = true, say = teamHumanSay, viewing = teamViewing, back, safety, held, phone, people, onEditRoom, seed = '', teamId = '', members = [], files = { attach: teamFileAttach, open: teamFileOpen, save: teamFileSave, pick: teamPickFiles } }: {
  convo: Convo;
  items: TeamItem[];
  team: string;
  myName: string;
  handed: Record<string, string>;
  onRead: (room: string) => void;
  onHanded: (it: TeamItem, to: string) => void;
  onSent: () => void;
  /** 내 참모(지금 채팅 칸 참모)에게 넘기기 — 없으면 '내 참모에게'가 안 보인다 */
  handoff?: Handoff;
  /** 이 대화를 따로 창으로(모니터가 둘 이상일 때만 준다) */
  detach?: () => void;
  /** 이 창이 앞에 있나 — 앞일 때만 읽음 처리 */
  focused?: boolean;
  /** 보내기 길 — 데스크톱은 team_human_say, 폰은 맥 폰 서버(/api/team-say). 둘 다 진짜 키·클릭 뒤 1.5초 안만(null = 문 밖) */
  say?: (to: string, text: string, trustedAt: number, extra?: SayExtra) => Promise<unknown> | null;
  /** 지금 보는 대화를 알리는 길(데스크톱 알림 판단) — 폰은 없음 */
  viewing?: (room: string) => void;
  /** 폰 — 머리 맨 앞 뒤로 */
  back?: () => void;
  /** 보안 번호 사람 상태(team_feed safety) — 상대가 바뀜·갈림이면 대화 위 알림(시안 e2e-safety v1) */
  safety?: SafetyPerson[];
  /** 보안 번호가 바뀌어 멈춘 말(team_feed held) — 받아들이면 보낸다 */
  held?: HeldMsg[];
  /** 폰 웹 — 보안 번호 패널은 보기만(받아들이기는 폰 결정 대기함 카드) */
  phone?: boolean;
  /** 단톡방 사람 이름(멤버 id → 이름) — 방 머리 얼굴 묶음 */
  people?: Record<string, string>;
  /** 단톡방 이름·사람 바꾸기 */
  onEditRoom?: () => void;
  /** 입력칸 첫 글(팀 홈 글 '대화로' — key 가 바뀔 때만 다시 읽는다) */
  seed?: string;
  /** 팀 id — 파일 붙이기(팀 보관함) */
  teamId?: string;
  /** 팀 사람(부르기 목록·이름 칩) — 단톡방은 방 사람만, DM 은 상대만 목록에 */
  members?: { id: string; name: string; me: boolean }[];
  /** 파일 길(팀 보관함 명령) — 시험이 바꿔 끼운다 */
  files?: { attach: typeof teamFileAttach; open: typeof teamFileOpen; save: typeof teamFileSave; pick: typeof teamPickFiles };
}) {
  const group = convo.kind === 'group';
  const { board } = useContext(ProfilesCtx);
  // 반응·파일은 데스크톱만(폰 /api/team-say 는 글만)
  const rich = !phone;
  const got = useMemo(() => (convo.room ? reactionsOf(items, convo.room) : new Map<number, Reaction[]>()), [items, convo.room]);
  // 보낸 뒤 서버 답을 기다리는 내 반응 — 누르자마자 얹고(withMyReacts), 받은 목록이 따라잡으면 뗀다. 실패하면 떼고 알린다
  const [pendReact, setPendReact] = useState<{ seq: number; mark: string; on: boolean }[]>([]);
  const reacts = useMemo(() => withMyReacts(got, pendReact, myName), [got, pendReact, myName]);
  useEffect(() => { setPendReact((x) => { const n = x.filter((p) => !!got.get(p.seq)?.find((r) => r.mark === p.mark)?.mine !== p.on); return n.length === x.length ? x : n; }); }, [got]);
  const names = useMemo(() => members.map((m) => m.name), [members]);
  const callable = useMemo(() => members.filter((m) => (group ? (convo.members ?? []).includes(m.id) : m.id === convo.peer || m.me)), [members, group, convo.members, convo.peer]);
  const [atts, setAtts] = useState<Att[]>([]);
  const [dropOver, setDropOver] = useState(false);
  const [menu, setMenu] = useState<{ start: number; q: string; sel: number } | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const picks: MentionPick[] = menu ? mentionList(menu.q, callable).slice(0, 8) : [];
  const lines = convo.room ? roomItems(items, convo.room) : [];
  const [text, setText] = useState(seed);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [handing, setHanding] = useState<TeamItem | null>(null);
  // 엔터 즉시 내 풍선 — 서버 seq 를 받아 기록에 같은 seq 가 보이면 지운다(기록 다시 읽기는 onSent)
  const [sending, setSending] = useState<{ id: number; text: string; seq?: number }[]>([]);
  // 폰 — 말을 누르면 그 말에만 '내 참모에게'(데스크톱은 올리면 보인다)
  const [picked, setPicked] = useState<number | null>(null);
  const [note, setNote] = useState('');
  const peer = safety?.find((p) => p.member === convo.peer);
  const stopped = !!peer && (peer.state === 'changed' || peer.state === 'forked');
  const [check, setCheck] = useState(false);
  const paused = (held ?? []).filter((h) => h.room && h.room === convo.room);
  // 바뀜·갈림 말 — 펼친 줄(seq)
  const [opened, setOpened] = useState<Record<number, boolean>>({});
  const trustedAt = useRef(0);
  const list = useRef<HTMLDivElement>(null);
  const top = lines[lines.length - 1]?.seq ?? 0;

  // 지금 보는 대화를 Rust 에 — 그 대화 새 말엔 안 울린다(창이 앞일 때만, Rust 가 창에 묻는다)
  useEffect(() => { viewing(convo.room); }, [convo.room]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { viewing(''); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (focused && convo.room && top) onRead(convo.room); }, [focused, convo.room, top]); // eslint-disable-line react-hooks/exhaustive-deps
  useLayoutEffect(() => { const el = list.current; if (el) el.scrollTop = el.scrollHeight; }, [convo.key, top, handing, sending.length]);
  useEffect(() => { setHanding(null); setErr(null); setSending([]); setPendReact([]); }, [convo.key]);

  const mark = (e: React.SyntheticEvent) => { trustedAt.current = e.nativeEvent.isTrusted ? Date.now() : 0; };
  const ready = atts.filter((a) => a.ref).map((a) => a.ref!);
  const uploading = atts.some((a) => a.busy);
  // 파일 붙이기 — 팀 보관함에 방 사람 기기마다 봉투로 올리고(team_locker) 참조만 말에 싣는다. 새 DM(방 아직 없음)은 첫 말 뒤에
  const attach = (paths: string[]) => {
    if (!paths.length || !rich) return;
    if (!convo.room || !teamId) { setErr(tr('첫 말을 보낸 뒤에 파일을 붙일 수 있어요', 'Send a first message, then attach files')); return; }
    const added = paths.map((p) => ({ key: `${p}#${Math.random()}`, name: p.split(/[\\/]/).pop() || p, busy: true }));
    setAtts((a) => [...a, ...added]);
    void files.attach(teamId, convo.room, paths).then((refs) => {
      setAtts((a) => a.map((x) => { const i = added.findIndex((y) => y.key === x.key); const r = i >= 0 ? refs[i] : undefined; return r ? { ...x, busy: false, size: r.size, name: r.name, ref: r } : x; }));
    }, (e: unknown) => setAtts((a) => a.map((x) => (added.some((y) => y.key === x.key) ? { ...x, busy: false, err: String(e) } : x))));
  };
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const f = (e: Event) => {
      const d = (e as CustomEvent<{ over?: boolean; paths?: string[] }>).detail;
      if (d.paths) { setDropOver(false); attach(d.paths); } else setDropOver(!!d.over);
    };
    el.addEventListener(TEAM_DROP_EVENT, f);
    return () => el.removeEventListener(TEAM_DROP_EVENT, f);
  });
  const react = (seq: number, markKey: string, on: boolean) => {
    if (pendReact.some((x) => x.seq === seq && x.mark === markKey)) return; // 보내는 중에 또 누름 — 한 번만
    const p = say(sayTarget(convo), '', trustedAt.current, { react: { seq, mark: markKey, on } });
    if (!p) return;
    const mine = { seq, mark: markKey, on };
    setPendReact((x) => [...x, mine]);
    void p.then(() => onSent(), (e: unknown) => { setPendReact((x) => x.filter((y) => y !== mine)); setErr(tr(`반응을 못 달았어요 — ${String(e)}`, `Reaction not sent — ${String(e)}`)); });
  };
  // 파일 풍선 — 누르면 스페이스(보관함과 같은 openTeamFile 길), 오른쪽 클릭 = 다른 앱으로 열기·이 기기에 저장
  const fileFail = (e: unknown) => setErr(tr(`파일을 못 열었어요 — ${String(e)}`, `Could not open the file — ${String(e)}`));
  const openFile = (f: TeamFile, app = false) => void openTeamFile((external) => files.open(f.team || teamId, f.id, external), f.name, app).catch(fileFail);
  const [fileMenu, setFileMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const onFileMenu = (e: React.MouseEvent, f: TeamFile) => setFileMenu({ x: e.clientX, y: e.clientY, items: [
    { label: tr('열기', 'Open'), run: () => openFile(f) },
    { label: tr('다른 앱으로 열기', 'Open with default app'), run: () => openFile(f, true) },
    { label: tr('이 기기에 저장', 'Save to this Mac'), sep: true, run: () => void files.save(f.team || teamId, f.id).catch(fileFail) },
  ] });
  const typed = (v: string, caret: number) => {
    setText(v);
    const q = atQuery(v, caret);
    setMenu(q ? { ...q, sel: 0 } : null);
  };
  const pickMention = (m: MentionPick) => {
    if (!menu) return;
    const v = `${text.slice(0, menu.start)}${m.insert} ${text.slice(menu.start + 1 + menu.q.length)}`;
    setText(v);
    setMenu(null);
    const at = menu.start + m.insert.length + 1;
    requestAnimationFrame(() => { input.current?.focus(); input.current?.setSelectionRange(at, at); });
  };
  const send = () => {
    const t = text.trim();
    if ((!t && !ready.length) || busy || uploading) return;
    const extra: SayExtra = ready.length ? { files: ready } : {};
    const p = ready.length ? say(sayTarget(convo), t, trustedAt.current, extra) : say(sayTarget(convo), t, trustedAt.current);
    trustedAt.current = 0;
    if (!p) { setErr(tr('이 칸에서 직접 친 말만 보내요 — 다시 쳐 줘', 'Only what you type here is sent — type it again')); return; }
    const id = Date.now() + Math.random();
    setSending((s) => [...s, { id, text: t || ready.map((f) => f.name).join(', ') }]);
    setText('');
    setAtts([]);
    setMenu(null);
    setErr(null);
    setBusy(true);
    void p.then((r) => {
      const seq = (r as { seq?: number } | null)?.seq;
      setSending((s) => s.map((x) => (x.id === id ? { ...x, seq } : x)));
      onSent();
    }, (e: unknown) => {
      setSending((s) => s.filter((x) => x.id !== id));
      // 보안 번호가 바뀌어 멈춘 말 — '멈춤' 풍선으로 보여 준다(받아들이면 보낸다)
      if (String(e).includes('멈춤')) { onSent(); return; }
      setText((cur) => cur || t);
      setErr(tr(`못 보냈어요 — ${String(e)}`, `Not sent — ${String(e)}`));
    }).finally(() => setBusy(false));
  };
  const handOver = () => {
    if (!handing || !handoff) return;
    const it = handing;
    void handoff.send(handoffText(it, team, note)).then(() => { onHanded(it, handoff.name); setHanding(null); setNote(''); }, (e: unknown) => setErr(tr(`못 넘겼어요 — ${String(e)}`, `Not handed off — ${String(e)}`)));
  };

  let prevAt: number | null = null;
  const now = Date.now();
  // 상대 프로필(사진·상태·상태 글) — DM 만. 방해 금지면 입력칸 위 한 줄(시안 team-settings v1 S)
  const look = group ? null : lookOf(board, convo.peer, convo.name);
  const dnd = look ? dndNotice(look) : null;
  return (
    <div className="tmx-convo" ref={box} data-team-drop={rich && convo.room ? '' : undefined} onKeyDownCapture={mark} onClickCapture={mark}>
      <header className="tmx-head">
        {back && <IconButton size="l" label={tr('뒤로', 'Back')} onClick={back}><IconBack /></IconButton>}
        {group ? <TeamMarkIcon name={convo.name} size={28} /> : <PersonOf member={convo.peer} name={convo.name} color={convo.color} size={28} />}
        <span className="tmx-head-tx"><b>{convo.name}</b><span>{group ? tr(`${convo.people ?? 0}명 · 참모도 이 팀챗에서 답해요`, `${convo.people ?? 0} people · assistants answer here too`) : (look && statusLine(look)) || tr(`${convo.name}의 참모도 이 대화에서 답해요`, `${convo.name}'s assistant answers here too`)}</span></span>
        {group && people && <span className="tmx-room-ppl">{(convo.members ?? []).slice(0, 5).map((m) => <PersonOf key={m} member={m} name={people[m] ?? '?'} color={personColor(people[m] ?? '?')} size={22} />)}</span>}
        {group && onEditRoom && <IconButton label={tr('팀챗 이름·사람 바꾸기', 'Edit team chat')} onClick={onEditRoom}><IconPencil /></IconButton>}
        {detach && <IconButton label={tr('이 대화 따로 창으로', 'Open this chat in its own window')} onClick={detach}><IconWindowOut /></IconButton>}
      </header>
      <div className="tmx-msgs" ref={list}>
        {stopped && peer && (
          <div className="tmx-sys"><span className="tmx-pill"><b>{peer.state === 'forked' ? tr(`${convo.name}의 기기 목록이 다르게 보여요`, `${convo.name}'s device list looks different`) : tr(`${convo.name}의 보안 번호가 바뀌었어요`, `${convo.name}'s safety number changed`)}</b>
            <button aria-expanded={check} onClick={() => setCheck((c) => !c)}>{tr('확인', 'Check')}</button></span></div>
        )}
        {stopped && peer && check && <SafetyPanel p={peer} teamName={team} readOnly={phone} onDone={() => { setCheck(false); onSent(); }} />}
        {lines.length === 0 && !sending.length && <div className="tmx-empty">{group ? tr(`${convo.name} 팀챗에 첫 말을 보내 봐요`, `Say hi in ${convo.name}`) : tr(`${convo.name}에게 첫 말을 보내 봐요`, `Say hi to ${convo.name}`)}</div>}
        {lines.map((it) => {
          const l = lineOf(it, myName, convo.name);
          const day = dayLabel(it.at, prevAt, now);
          prevAt = it.at;
          const to = handed[`${it.room}:${it.seq}`];
          // 받지 않은 말·확인 전인 말(종단 암호 표시)은 참모에게 안 넘긴다
          const canHand = !!handoff && l.kind !== 'blocked' && l.kind !== 'e2e' && !(l.kind === 'bubble' && l.side === 'me') && !(l.kind === 'agent' && l.mine);
          const hand = canHand && <button className="tmx-hand" onClick={() => { setHanding(it); setNote(''); }}>{tr('내 참모에게', 'To my assistant')}</button>;
          const rs = reacts.get(it.seq) ?? [];
          const canReact = rich && (l.kind === 'bubble' || l.kind === 'agent');
          const add = canReact && <ReactAdd mine={rs.filter((r: { mine: boolean }) => r.mine).map((r: { mark: string }) => r.mark)} onPick={(k, on) => react(it.seq, k, on)} />;
          const chips = <Reacts list={rs} onToggle={canReact ? (k, on) => react(it.seq, k, on) : undefined} />;
          const fs = it.files?.length ? <FileBubbles files={it.files} me={l.kind === 'bubble' && l.side === 'me'} onOpen={rich ? (f) => openFile(f) : undefined} onMenu={rich ? onFileMenu : undefined} /> : null;
          const hl = l.kind !== 'blocked' && l.kind !== 'e2e' && !(l.kind === 'bubble' && l.side === 'me') && mentionsMe(it.body, myName);
          return (
            <div key={it.seq} className="tmx-line" data-seq={it.seq}>
              {day && <div className="tmx-day">{day}</div>}
              {l.kind === 'blocked' && <div className="tmx-blocked">{l.text}</div>}
              {l.kind === 'e2e' && (
                <>
                  <div className={`tmx-e2e ${l.tone}`}>{l.text}{l.body && l.folded && <IconButton size="s" className="tmx-e2e-open" pressed={!!opened[l.seq]} label={opened[l.seq] ? tr('본문 접기', 'Hide text') : tr('본문 보기', 'Show text')} onClick={() => setOpened((o) => ({ ...o, [l.seq]: !o[l.seq] }))}>{opened[l.seq] ? <IconChevronUp /> : <IconChevronDown />}</IconButton>}</div>
                  {l.body && (!l.folded || opened[l.seq]) && <div className="tmx-e2e-body">{l.body}</div>}
                </>
              )}
              {l.kind === 'bubble' && l.side === 'me' && (
                <>
                  <div className="tmx-me">{add}<span className="tmx-at">{stamp(l.at, now)}</span><div className="tmx-col">{l.text && <div className="tmx-bub me"><MentionText text={l.text} names={names} myName={myName} /></div>}{fs}</div></div>
                  {rs.length > 0 && <div className="tmx-reacts me">{chips}</div>}
                </>
              )}
              {l.kind === 'bubble' && l.side === 'them' && (
                <div className={`tmx-row ${picked === it.seq ? 'picked' : ''} ${hl ? 'hl' : ''}`} onClick={() => setPicked((p) => (p === it.seq ? null : it.seq))}><PersonOf member={it.member} name={l.name} color={l.color} size={28} />
                  <div className="tmx-col"><span className="tmx-nm">{l.name} <span className="tmx-at">{stamp(l.at, now)}</span></span>{l.text && <div className="tmx-bub"><MentionText text={l.text} names={names} myName={myName} /></div>}{fs}{chips}</div>{add}{hand}</div>
              )}
              {l.kind === 'agent' && (
                <div className={`tmx-row ${picked === it.seq ? 'picked' : ''} ${hl ? 'hl' : ''}`} onClick={() => setPicked((p) => (p === it.seq ? null : it.seq))}>{l.helper ? <HelperFace size={28} /> : <Face color={l.color} size={28} />}
                  <div className="tmx-col"><span className="tmx-nm">{l.name} {l.helper ? <span className="tmx-by">{l.tag}</span> : <span>{l.tag}</span>} <span className="tmx-at">{stamp(l.at, now)}</span></span>{l.text && <div className="tmx-plain"><MentionText text={l.text} names={names} myName={myName} /></div>}{fs}{chips}</div>{add}{hand}</div>
              )}
              {to && <div className="tmx-handed">{tr(`${to}에게 넘김`, `Forwarded to ${to}`)}</div>}
            </div>
          );
        })}
        {sending.filter((x) => x.seq === undefined || !lines.some((it) => it.seq === x.seq)).map((x) => (
          <div key={x.id} className="tmx-line"><div className="tmx-me"><div className="tmx-bub me sending">{x.text}</div></div></div>
        ))}
        {paused.map((h) => (
          <div key={h.cid} className="tmx-line">
            <div className="tmx-me"><div className="tmx-bub me wait">{h.body}</div></div>
            <div className="tmx-held">{tr('멈춤 — 받아들이면 보내요', 'Paused — sent once you accept')}</div>
          </div>
        ))}
      </div>
      {handing && handoff && (
        <div className="tmx-card" role="group" aria-label={tr('내 참모에게 넘기기', 'Forward to my assistant')}>
          <div className="tmx-card-h">
            <b>{handing.person}</b><span>{handing.origin === 'human' ? tr('사람 말', 'Human') : tr('참모 말', 'Assistant')} · {team}</span>
            <IconButton size="s" label={tr('닫기', 'Close')} onClick={() => setHanding(null)}><IconClose /></IconButton>
          </div>
          <div className="tmx-card-q">{handing.body}</div>
          <textarea className="tmx-card-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder={tr(`${handoff.name}에게 붙일 말`, `A note for ${handoff.name}`)} />
          <div className="tmx-card-a"><button className="tmx-btn pri" onClick={handOver}>{tr(`${handoff.name}에게 넘기기`, `Forward to ${handoff.name}`)}</button></div>
        </div>
      )}
      {err && <div className="tmx-err" role="alert">{err}</div>}
      {dropOver && <div className="tmx-dropov"><div><b>{tr(`${convo.name}에 파일 붙이기`, `Attach to ${convo.name}`)}</b><span>{tr('종단 암호로 올려요', 'Uploaded end-to-end encrypted')}</span></div></div>}
      {dnd && <div className="tmp-dnd" role="note">{dnd}</div>}
      <div className="tmx-compw">
        {menu && <MentionMenu items={picks} sel={Math.min(menu.sel, Math.max(0, picks.length - 1))} onPick={pickMention} />}
        <Attachments list={atts} onRemove={(k) => setAtts((a) => a.filter((x) => x.key !== k))} />
        <div className="tmx-comp">
          {rich && convo.room && <IconButton label={tr('파일 붙이기', 'Attach files')} onClick={() => void files.pick().then(attach, (e: unknown) => setErr(tr(`파일 창을 못 열었어요 — ${String(e)}`, `Could not open the file picker — ${String(e)}`)))}><IconPlus /></IconButton>}
          <textarea ref={input} rows={1} value={text} onChange={(e) => typed(e.target.value, e.target.selectionStart ?? e.target.value.length)} placeholder={group ? tr(`${convo.name}에 보내기 — @ 로 부르기`, `Message ${convo.name} — @ to mention`) : tr(`${convo.name}에게`, `To ${convo.name}`)} aria-label={tr(`${convo.name}에게 보낼 말`, `Message to ${convo.name}`)}
            onBlur={() => setMenu(null)}
            onKeyDown={(e) => {
              if (menu && picks.length) {
                if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); setMenu((m) => m && { ...m, sel: (m.sel + (e.key === 'ArrowDown' ? 1 : picks.length - 1)) % picks.length }); return; }
                if ((e.key === 'Enter' || e.key === 'Tab') && !e.nativeEvent.isComposing) { e.preventDefault(); pickMention(picks[Math.min(menu.sel, picks.length - 1)]!); return; }
                if (e.key === 'Escape') { e.preventDefault(); setMenu(null); return; }
              }
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); }
            }} />
          <IconButton label={tr('보내기', 'Send')} disabled={busy || uploading || (!text.trim() && !ready.length)} onClick={send}><IconEnter /></IconButton>
        </div>
      </div>
      {fileMenu && <ContextMenu x={fileMenu.x} y={fileMenu.y} items={fileMenu.items} onClose={() => setFileMenu(null)} />}
    </div>
  );
}
