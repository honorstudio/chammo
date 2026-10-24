// 메신저 대화 칸 — 앱 안 가운데 칸·메신저 따로 창·대화 하나 창이 같이 쓴다(시안 v2).
// 모양: 풍선 = 사람(내 말은 오른쪽), 얼굴 + 맨 글 = 참모(남의 참모는 '하린의 참모' 꼬리표). 남의 말 위에 올리면 '내 참모에게' → 카드로 넘긴다.
// 보내기는 사람 말(team_human_say) — 이 칸 안의 진짜(isTrusted) 키·클릭 뒤 1.5초 안만(HUMAN_POSTS 와 같은 문, teamApi)
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { teamHumanSay, teamViewing } from '../../data/teamApi';
import { dayLabel, handoffText, lineOf, roomItems, stamp, type Convo, type TeamItem } from '../../domain/teamChat';
import { tr } from '../../i18n';
import { IconBack, IconClose, IconDockIn, IconEnter, IconWindowOut } from '../Icons';
import { IconButton } from '../kit/IconButton';
import { Face, Person } from './TeamFaces';
import './team.css';

export type Handoff = { name: string; send: (text: string) => Promise<void> };

export function TeamConvo({ convo, items, team, myName, handed, onRead, onHanded, onSent, handoff, detach, dock, focused = true, say = teamHumanSay, viewing = teamViewing, back }: {
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
  /** 따로 창 머리 — 앱에 붙이기 */
  dock?: () => void;
  /** 이 창이 앞에 있나 — 앞일 때만 읽음 처리 */
  focused?: boolean;
  /** 보내기 길 — 데스크톱은 team_human_say, 폰은 맥 폰 서버(/api/team-say). 둘 다 진짜 키·클릭 뒤 1.5초 안만(null = 문 밖) */
  say?: (to: string, text: string, trustedAt: number) => Promise<unknown> | null;
  /** 지금 보는 대화를 알리는 길(데스크톱 알림 판단) — 폰은 없음 */
  viewing?: (room: string) => void;
  /** 폰 — 머리 맨 앞 뒤로 */
  back?: () => void;
}) {
  const lines = convo.room ? roomItems(items, convo.room) : [];
  const [text, setText] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [handing, setHanding] = useState<TeamItem | null>(null);
  // 폰 — 말을 누르면 그 말에만 '내 참모에게'(데스크톱은 올리면 보인다)
  const [picked, setPicked] = useState<number | null>(null);
  const [note, setNote] = useState('');
  const trustedAt = useRef(0);
  const list = useRef<HTMLDivElement>(null);
  const top = lines[lines.length - 1]?.seq ?? 0;

  // 지금 보는 대화를 Rust 에 — 그 대화 새 말엔 안 울린다(창이 앞일 때만, Rust 가 창에 묻는다)
  useEffect(() => { viewing(convo.room); }, [convo.room]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { viewing(''); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (focused && convo.room && top) onRead(convo.room); }, [focused, convo.room, top]); // eslint-disable-line react-hooks/exhaustive-deps
  useLayoutEffect(() => { const el = list.current; if (el) el.scrollTop = el.scrollHeight; }, [convo.key, top, handing]);
  useEffect(() => { setHanding(null); setErr(null); }, [convo.key]);

  const mark = (e: React.SyntheticEvent) => { trustedAt.current = e.nativeEvent.isTrusted ? Date.now() : 0; };
  const send = () => {
    const t = text.trim();
    if (!t || busy) return;
    const p = say(convo.peer, t, trustedAt.current);
    trustedAt.current = 0;
    if (!p) { setErr(tr('이 칸에서 직접 친 말만 보내요 — 다시 쳐 줘', 'Only what you type here is sent — type it again')); return; }
    setBusy(true);
    void p.then(() => { setText(''); setErr(null); onSent(); }, (e: unknown) => setErr(tr(`못 보냈어요 — ${String(e)}`, `Not sent — ${String(e)}`))).finally(() => setBusy(false));
  };
  const handOver = () => {
    if (!handing || !handoff) return;
    const it = handing;
    void handoff.send(handoffText(it, team, note)).then(() => { onHanded(it, handoff.name); setHanding(null); setNote(''); }, (e: unknown) => setErr(tr(`못 넘겼어요 — ${String(e)}`, `Not handed off — ${String(e)}`)));
  };

  let prevAt: number | null = null;
  const now = Date.now();
  return (
    <div className="tmx-convo" onKeyDownCapture={mark} onClickCapture={mark}>
      <header className="tmx-head">
        {back && <IconButton size="l" label={tr('뒤로', 'Back')} onClick={back}><IconBack /></IconButton>}
        <Person name={convo.name} color={convo.color} size={28} />
        <span className="tmx-head-tx"><b>{convo.name}</b><span>{tr(`${convo.name}의 참모도 이 대화에서 답해요`, `${convo.name}'s assistant answers here too`)}</span></span>
        {detach && <IconButton label={tr('이 대화 따로 창으로', 'Open this chat in its own window')} onClick={detach}><IconWindowOut /></IconButton>}
        {dock && <IconButton label={tr('앱에 붙이기', 'Dock into the app')} onClick={dock}><IconDockIn /></IconButton>}
      </header>
      <div className="tmx-msgs" ref={list}>
        {lines.length === 0 && <div className="tmx-empty">{tr(`${convo.name}에게 첫 말을 보내 봐요`, `Say hi to ${convo.name}`)}</div>}
        {lines.map((it) => {
          const l = lineOf(it, myName, convo.name);
          const day = dayLabel(it.at, prevAt, now);
          prevAt = it.at;
          const to = handed[`${it.room}:${it.seq}`];
          const canHand = !!handoff && l.kind !== 'blocked' && !(l.kind === 'bubble' && l.side === 'me') && !(l.kind === 'agent' && l.mine);
          const hand = canHand && <button className="tmx-hand" onClick={() => { setHanding(it); setNote(''); }}>{tr('내 참모에게', 'To my assistant')}</button>;
          return (
            <div key={it.seq} className="tmx-line" data-seq={it.seq}>
              {day && <div className="tmx-day">{day}</div>}
              {l.kind === 'blocked' && <div className="tmx-blocked">{l.text}</div>}
              {l.kind === 'bubble' && l.side === 'me' && <div className="tmx-me"><div className="tmx-bub me" title={stamp(l.at, now)}>{l.text}</div></div>}
              {l.kind === 'bubble' && l.side === 'them' && (
                <div className={`tmx-row ${picked === it.seq ? 'picked' : ''}`} onClick={() => setPicked((p) => (p === it.seq ? null : it.seq))}><Person name={l.name} color={l.color} size={28} />
                  <div className="tmx-col"><span className="tmx-nm">{l.name}</span><div className="tmx-bub" title={stamp(l.at, now)}>{l.text}</div></div>{hand}</div>
              )}
              {l.kind === 'agent' && (
                <div className={`tmx-row ${picked === it.seq ? 'picked' : ''}`} onClick={() => setPicked((p) => (p === it.seq ? null : it.seq))}><Face color={l.color} size={28} />
                  <div className="tmx-col"><span className="tmx-nm">{l.name} <span>{l.tag}</span></span><div className="tmx-plain" title={stamp(l.at, now)}>{l.text}</div></div>{hand}</div>
              )}
              {to && <div className="tmx-handed">{tr(`${to}에게 넘김`, `Forwarded to ${to}`)}</div>}
            </div>
          );
        })}
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
      <div className="tmx-comp">
        <textarea rows={1} value={text} onChange={(e) => setText(e.target.value)} placeholder={tr(`${convo.name}에게`, `To ${convo.name}`)} aria-label={tr(`${convo.name}에게 보낼 말`, `Message to ${convo.name}`)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); } }} />
        <IconButton label={tr('보내기', 'Send')} disabled={busy || !text.trim()} onClick={send}><IconEnter /></IconButton>
      </div>
    </div>
  );
}
