// 팀 홈 판 블록 몸통(ADR 0018 8) — 팀원·팀 참모·최근 파일·링크·글 한 칸·진행 중. 고정 공지·글 목록은 TeamHome 이 그린다(글 길 그대로)
// 링크·글 한 칸·진행 중은 팀원 누구나 고친다(블록마다 한 판, Rust team_home_store::save_content)
import { useContext, useState } from 'react';
import { personColor } from '../../domain/teamChat';
import { blankContent, GOALS_MAX, goalFix, LINKS_MAX, linkProblem, NOTE_MAX, recentFiles, specOf, type Content, type ContentDraft, type HomeBlock } from '../../domain/teamHome';
import type { AgentShown } from '../../domain/teamAgent';
import { extOf, whenText, type LockerItem } from '../../domain/teamLocker';
import { lookOf, statusLine } from '../../domain/teamProfile';
import { tr } from '../../i18n';
import { IconClose, IconPencil, IconPlus } from '../Icons';
import { IconButton } from '../kit/IconButton';
import { AgentFace } from './RoomBits';
import { PersonOf } from './TeamFaces';
import { ProfilesCtx } from './useProfiles';

export type BlockData = {
  members: { id: string; name: string }[];
  agents: AgentShown[];
  files: LockerItem[];
  content: Record<string, Content>;
  /** 팀챗 입력칸에 한 줄(@이름) — 없으면 참모 블록은 누를 수 없다 */
  onTalk?: (text: string) => void;
  openFile?: (i: LockerItem) => void;
  openUrl: (url: string) => void;
  saveContent: (block: string, c: ContentDraft) => Promise<unknown>;
  nameOf: (member: string) => string;
};

const Head = ({ b, children }: { b: HomeBlock; children?: React.ReactNode }) => (
  <div className="hb-bh">{specOf(b.k).name()}<span className="hb-sp" />{children}</div>
);

function Members({ d }: { d: BlockData }) {
  const { board } = useContext(ProfilesCtx);
  return (
    <div className="hb-rows">
      {d.members.map((m) => {
        const l = lookOf(board, m.id, m.name);
        return (
          <div key={m.id} className="hb-row">
            <PersonOf member={m.id} name={m.name} color={personColor(m.name)} size={28} />
            <span className="hb-tx"><b>{l.name}</b>{statusLine(l) && <span>{statusLine(l)}</span>}</span>
          </div>
        );
      })}
    </div>
  );
}

function Agents({ d }: { d: BlockData }) {
  const list = d.agents.filter((a) => !a.clash);
  if (!list.length) return <div className="hb-none">{tr('아직 팀 참모가 없어요 — 팀 설정에서 만들어요', 'No team helpers yet — make one in team settings')}</div>;
  return (
    <div className="hb-agents">
      {list.map((a) => (
        <button key={a.id} className="hb-ag" disabled={!d.onTalk} title={tr(`팀챗에서 @${a.def.name} 부르기`, `Mention @${a.def.name} in the team chat`)}
          onClick={() => d.onTalk?.(`@${a.def.name} `)}>
          <AgentFace def={a.def} size={26} />
          <span className="hb-tx"><b>{a.def.name}</b>{a.def.blurb && <span>{a.def.blurb}</span>}</span>
        </button>
      ))}
    </div>
  );
}

function Files({ d, n }: { d: BlockData; n: number }) {
  const list = recentFiles(d.files, n);
  if (!list.length) return <div className="hb-none">{tr('팀 보관함에 아직 파일이 없어요', 'No files in the team locker yet')}</div>;
  return (
    <div className="hb-rows">
      {list.map((i) => {
        const inner = <><span className="hb-ext" aria-hidden="true">{extOf(i.name)}</span><span className="hb-tx"><b>{i.name}</b><span>{[d.nameOf(i.byMember), whenText(i.at)].filter(Boolean).join(' · ')}</span></span></>;
        return d.openFile ? <button key={i.id} className="hb-row" onClick={() => d.openFile!(i)}>{inner}</button> : <div key={i.id} className="hb-row">{inner}</div>;
      })}
    </div>
  );
}

/** 링크·글 한 칸·진행 중 고치기 — 블록 안에서 바로(팀원 누구나), 저장하면 그 블록 내용 한 판 */
function ContentEdit({ b, start, save, onDone }: { b: HomeBlock; start: Content; save: BlockData['saveContent']; onDone: () => void }) {
  const [c, setC] = useState<ContentDraft>({ links: start.links, note: start.note, goals: start.goals });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const bad = b.k === 'links' ? c.links.map(linkProblem).find(Boolean) ?? '' : '';
  const go = () => {
    if (bad) return setErr(bad);
    setBusy(true);
    void save(b.id, { ...c, goals: c.goals.filter((g) => g.name.trim()).map(goalFix) }).then(onDone, (e: unknown) => setErr(String(e))).finally(() => setBusy(false));
  };
  return (
    <div className="hb-edit">
      {b.k === 'note' && <>
        <input aria-label={tr('제목', 'Title')} placeholder={tr('제목', 'Title')} maxLength={60} value={c.note.title} onChange={(e) => setC({ ...c, note: { ...c.note, title: e.target.value } })} />
        <textarea aria-label={tr('내용', 'Text')} maxLength={NOTE_MAX} value={c.note.body} onChange={(e) => setC({ ...c, note: { ...c.note, body: e.target.value } })} />
      </>}
      {b.k === 'links' && <>
        {c.links.map((l, i) => (
          <div key={i} className="hb-edit-row">
            <input aria-label={tr('이름', 'Name')} placeholder={tr('이름', 'Name')} maxLength={40} value={l.name} onChange={(e) => setC({ ...c, links: c.links.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} />
            <input aria-label={tr('주소', 'Address')} placeholder="https://" value={l.url} onChange={(e) => setC({ ...c, links: c.links.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)) })} />
            <IconButton size="s" label={tr('빼기', 'Remove')} onClick={() => setC({ ...c, links: c.links.filter((_, j) => j !== i) })}><IconClose /></IconButton>
          </div>
        ))}
        {c.links.length < LINKS_MAX && <IconButton size="s" tone="line" label={tr('링크 더하기', 'Add a link')} onClick={() => setC({ ...c, links: [...c.links, { name: '', url: '' }] })}><IconPlus /></IconButton>}
      </>}
      {b.k === 'goals' && <>
        {c.goals.map((g, i) => (
          <div key={i} className="hb-edit-row">
            <input aria-label={tr('목표', 'Goal')} placeholder={tr('목표', 'Goal')} maxLength={40} value={g.name} onChange={(e) => setC({ ...c, goals: c.goals.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} />
            <input className="num" type="number" min={0} max={99} aria-label={tr('끝낸 칸', 'Done')} value={g.done} onChange={(e) => setC({ ...c, goals: c.goals.map((x, j) => (j === i ? { ...x, done: Number(e.target.value) } : x)) })} />
            <span className="hb-s2">/</span>
            <input className="num" type="number" min={1} max={99} aria-label={tr('전체 칸', 'Total')} value={g.total} onChange={(e) => setC({ ...c, goals: c.goals.map((x, j) => (j === i ? { ...x, total: Number(e.target.value) } : x)) })} />
            <IconButton size="s" label={tr('빼기', 'Remove')} onClick={() => setC({ ...c, goals: c.goals.filter((_, j) => j !== i) })}><IconClose /></IconButton>
          </div>
        ))}
        {c.goals.length < GOALS_MAX && <IconButton size="s" tone="line" label={tr('목표 더하기', 'Add a goal')} onClick={() => setC({ ...c, goals: [...c.goals, { name: '', done: 0, total: 5 }] })}><IconPlus /></IconButton>}
      </>}
      {(err || bad) && <div className="hb-edit-err" role="alert">{err || bad}</div>}
      <div className="hb-edit-foot">
        <button className="tmx-btn" disabled={busy} onClick={onDone}>{tr('취소', 'Cancel')}</button>
        {/* 팀 모두에게 바로 보이는 일이라 글자 단추 */}
        <button className="tmx-btn pri" disabled={busy || !!bad} onClick={go}>{tr('저장', 'Save')}</button>
      </div>
    </div>
  );
}

function ContentView({ b, c, d }: { b: HomeBlock; c: Content; d: BlockData }) {
  if (b.k === 'note') return c.note.title || c.note.body ? <div className="hb-note">{c.note.title && <b>{c.note.title}</b>}{c.note.body && <p>{c.note.body}</p>}</div> : <div className="hb-none">{tr('비어 있어요 — 연필로 적어요', 'Empty — write with the pencil')}</div>;
  if (b.k === 'links') {
    if (!c.links.length) return <div className="hb-none">{tr('비어 있어요 — 연필로 더해요', 'Empty — add with the pencil')}</div>;
    return (
      <div className="hb-rows">
        {c.links.map((l, i) => <a key={i} className="hb-row" href={l.url} onClick={(e) => { e.preventDefault(); d.openUrl(l.url); }}><span className="hb-tx"><b>{l.name}</b><span>{l.url.replace(/^https?:\/\//, '').split('/')[0]}</span></span></a>)}
      </div>
    );
  }
  if (!c.goals.length) return <div className="hb-none">{tr('비어 있어요 — 연필로 더해요', 'Empty — add with the pencil')}</div>;
  return (
    <div>
      {c.goals.map((g, i) => (
        <div key={i} className="hb-goal">
          <div className="hb-gt"><b>{g.name}</b><span>{g.done}/{g.total}</span></div>
          <div className="hb-bar" role="progressbar" aria-label={g.name} aria-valuemin={0} aria-valuemax={g.total} aria-valuenow={g.done}><i style={{ width: `${Math.round((g.done / g.total) * 100)}%` }} /></div>
        </div>
      ))}
    </div>
  );
}

/** 팀원·팀 참모·최근 파일·링크·글 한 칸·진행 중 블록 하나(머리 포함). editing = 꾸미기 모드(안 내용은 못 고침) */
export function DataBlock({ b, d, editing }: { b: HomeBlock; d: BlockData; editing: boolean }) {
  const [edit, setEdit] = useState(false);
  const own = b.k === 'links' || b.k === 'note' || b.k === 'goals';
  const c = d.content[b.id] ?? blankContent();
  const by = c.by ? d.nameOf(c.by) : '';
  return (
    <>
      <Head b={b}>
        {b.k === 'members' && <span className="hb-s2">{tr(`${d.members.length}명`, `${d.members.length}`)}</span>}
        {own && !edit && !editing && <IconButton size="s" label={tr('고치기', 'Edit')} title={by ? tr(`고치기 · 마지막 ${by}`, `Edit · last by ${by}`) : undefined} onClick={() => setEdit(true)}><IconPencil /></IconButton>}
      </Head>
      {b.k === 'members' && <Members d={d} />}
      {b.k === 'agents' && <Agents d={d} />}
      {b.k === 'files' && <Files d={d} n={b.w === 'full' ? 6 : 4} />}
      {own && (edit ? <ContentEdit b={b} start={c} save={d.saveContent} onDone={() => setEdit(false)} /> : <ContentView b={b} c={c} d={d} />)}
    </>
  );
}
