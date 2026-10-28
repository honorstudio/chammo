// 메신저 방 화면 v2 조각(시안 msg-rooms v2) — 부르기 글·반응 칩·반응 고르기·파일 풍선·부르기 목록·팀 참모 얼굴.
// 강조는 옅은 면·전체 테두리·굵기(왼쪽 색 띠 없음). 반응 표식은 이모지 대신 Icons.tsx 의 직접 그린 SVG
import { Fragment, useEffect, useState } from 'react';
import { fileSize, mentionParts, type MentionPick, type Reaction, type TeamFile } from '../../domain/teamChat';
import { tr } from '../../i18n';
import { IconClose, IconDoc, IconLock, IconReactAdd, REACT_MARKS } from '../Icons';
import { Person } from './TeamFaces';
import { personColor } from '../../domain/teamChat';
import { thumbKind } from '../../domain/teamLocker';
import { linkParts } from '../../domain/links';
import { OrchPickRow } from './OrchPick';
import { agentColor } from '../../domain/teamAgent';
import './team.css';
import './teamAgent.css';

const markOf = (k: string) => REACT_MARKS.find((m) => m.key === k);
const markName = (k: string) => { const m = markOf(k); return m ? tr(m.ko, m.en) : k; };

/** 글 — 아는 이름의 @부르기만 칩으로, 내 이름은 진하게. 웹 주소는 링크(newTab = 폰, 새 탭으로) */
export function MentionText({ text, names, myName, newTab }: { text: string; names: string[]; myName: string; newTab?: boolean }) {
  return <>{mentionParts(text, names, myName).map((p, i) => (p.t === 'text' ? <span key={i}><Linked s={p.s} newTab={newTab} /></span> : <span key={i} className={`tmx-mn ${p.me ? 'me' : ''}`}>{p.s}</span>))}</>;
}

/** 맨 글 속 웹 주소(http·https)만 링크 — 보이는 글이 곧 주소, title 도 주소. 데스크톱은 말 목록 클릭(openWebLink)이 기본 브라우저로 열고, 폰은 새 탭 */
function Linked({ s, newTab }: { s: string; newTab?: boolean }) {
  return <>{linkParts(s).map((p, i) => (p.t === 'url' ? <a key={i} href={p.s} title={p.s} target={newTab ? '_blank' : undefined} rel="noopener noreferrer">{p.s}</a> : <Fragment key={i}>{p.s}</Fragment>))}</>;
}

/** 팀 참모 얼굴 — 눈 셋(내 참모·남의 참모와 갈리게) */
/** 팀 참모(ADR 0017) 얼굴 — 이름 첫 글자 + 정의 색, 둥근 네모(사람 동그라미와 갈림). 모양은 teamAgent.css */
export function AgentFace({ def, size = 28 }: { def: { name: string; color: number }; size?: number }) {
  return <span className="tma-face" style={{ ['--s' as string]: `${size}px`, background: agentColor(def.color) }} aria-hidden="true">{[...def.name][0] ?? ''}</span>;
}

export const HelperFace = ({ size = 28 }: { size?: number }) => (
  <span className="tmx-th" style={{ ['--s' as string]: `${size}px` }} aria-hidden="true"><i /><i /><i /></span>
);

/** 반응 줄 — 표식 + 수, 내가 단 것은 테두리. 올리면 누가 달았는지. 누르면 달기·떼기 */
export function Reacts({ list, onToggle }: { list: Reaction[]; onToggle?: (mark: string, on: boolean) => void }) {
  const [hover, setHover] = useState<string | null>(null);
  if (!list.length) return null;
  return (
    <div className="tmx-reacts">
      {list.map((r) => {
        const M = markOf(r.mark)?.icon;
        return (
          <button key={r.mark} className={`tmx-chip ${r.mine ? 'mine' : ''}`} aria-pressed={r.mine} disabled={!onToggle}
            aria-label={tr(`${markName(r.mark)} ${r.who.length} — ${r.who.join(', ')}`, `${markName(r.mark)} ${r.who.length} — ${r.who.join(', ')}`)}
            onMouseEnter={() => setHover(r.mark)} onMouseLeave={() => setHover(null)} onClick={() => onToggle?.(r.mark, !r.mine)}>
            {M && <M />}<b>{r.who.length}</b>
            {hover === r.mark && <span className="tmx-who" role="tooltip"><span className="tmx-who-mk">{M && <M />}</span><span><b>{markName(r.mark)}</b>{r.who.join(', ')}</span></span>}
          </button>
        );
      })}
    </div>
  );
}

/** 반응 달기 단추 + 고르기 막대(다섯 표식) */
export function ReactAdd({ mine, onPick }: { mine: string[]; onPick: (mark: string, on: boolean) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="tmx-react-add">
      <button className="tmx-react-btn" aria-label={tr('반응 달기', 'Add a reaction')} title={tr('반응 달기', 'Add a reaction')} aria-expanded={open} onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}><IconReactAdd /></button>
      {open && (
        <span className="tmx-picker" role="menu" aria-label={tr('반응 고르기', 'Pick a reaction')} onMouseLeave={() => setOpen(false)}>
          {REACT_MARKS.map((m) => {
            const on = mine.includes(m.key);
            return <button key={m.key} role="menuitemcheckbox" aria-checked={on} className={`tmx-pk ${on ? 'on' : ''}`} aria-label={tr(m.ko, m.en)} title={tr(m.ko, m.en)}
              onClick={(e) => { e.stopPropagation(); setOpen(false); onPick(m.key, !on); }}><m.icon /></button>;
          })}
        </span>
      )}
    </span>
  );
}

/** 썸네일 길 — 데스크톱은 풀어 둔 그림·PDF 첫 장(teamApi teamFileThumb), 폰은 맥이 줄인 JPEG. 못 그리면 null */
export type ThumbOf = { get: (f: TeamFile) => Promise<string | null>; forget?: (f: TeamFile) => void };

/** 파일 풍선 — 그림은 썸네일 크게, PDF 는 첫 장을 아이콘 자리에, 그 밖은 아이콘(10-28 사용자 "썸네일 없이 빈 네모").
 *  이름·크기·자물쇠(종단 암호). 누르면 스페이스에서 연다(보관함과 같은 길), 오른쪽 클릭 = 다른 앱으로 열기·저장 */
export function FileBubbles({ files, me, onOpen, onMenu, thumb }: { files: TeamFile[]; me?: boolean; onOpen?: (f: TeamFile) => void; onMenu?: (e: React.MouseEvent, f: TeamFile) => void; thumb?: ThumbOf }) {
  return (
    <div className="tmx-files">
      {files.map((f) => <FileBubble key={f.id} f={f} me={me} onOpen={onOpen} onMenu={onMenu} thumb={thumb} />)}
    </div>
  );
}

function FileBubble({ f, me, onOpen, onMenu, thumb }: { f: TeamFile; me?: boolean; onOpen?: (f: TeamFile) => void; onMenu?: (e: React.MouseEvent, f: TeamFile) => void; thumb?: ThumbOf }) {
  const kind = thumb ? thumbKind(f.name, f.size) : null;
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    setSrc(null);
    if (!kind || !thumb) return;
    let live = true;
    thumb.get(f).then((u) => { if (live) setSrc(u); }, () => {});
    return () => { live = false; };
  }, [f.id, f.team, kind]); // eslint-disable-line react-hooks/exhaustive-deps
  const forget = (x: TeamFile) => thumb?.forget?.(x);
  const pic = kind === 'image' && !!src;
  const img = src && <img src={src} alt="" draggable={false} onError={() => { forget(f); setSrc(null); }} />;
  const inner = (
    <>
      {pic && <span className="tmx-file-pic">{img}</span>}
      <span className="tmx-file-row">
        {!pic && <span className={`tmx-file-ic ${kind === 'pdf' && src ? 'pg' : ''}`}>{kind === 'pdf' && src ? img : <IconDoc />}</span>}
        <span className="tmx-file-tx"><b title={f.name}>{f.name}</b><span><IconLock />{fileSize(f.size)}</span></span>
      </span>
    </>
  );
  const cls = `tmx-file ${me ? 'me' : ''} ${pic ? 'has-pic' : ''}`;
  return onOpen
    ? <button type="button" className={cls} title={tr(`${f.name} 열기`, `Open ${f.name}`)} onClick={(e) => { e.stopPropagation(); onOpen(f); }} onContextMenu={onMenu ? (e) => { e.preventDefault(); onMenu(e, f); } : undefined}>{inner}</button>
    : <div className={cls}>{inner}</div>;
}

/** 보내기 전 붙인 파일 칩 — 올리는 중이면 이름만 흐리게 */
export function Attachments({ list, onRemove }: { list: { key: string; name: string; size?: number; busy?: boolean; err?: string }[]; onRemove: (key: string) => void }) {
  if (!list.length) return null;
  return (
    <div className="tmx-atts">
      {list.map((a) => (
        <span key={a.key} className={`tmx-att ${a.busy ? 'busy' : ''} ${a.err ? 'err' : ''}`} title={a.err}>
          <span className="tmx-file-ic s"><IconDoc /></span><b>{a.name}</b>
          <span>{a.err ? tr('못 올림', 'Failed') : a.busy ? tr('올리는 중', 'Uploading') : a.size !== undefined ? fileSize(a.size) : ''}</span>
          <button className="tmx-att-x" aria-label={tr(`${a.name} 빼기`, `Remove ${a.name}`)} title={tr('빼기', 'Remove')} onClick={() => onRemove(a.key)}><IconClose /></button>
        </span>
      ))}
    </div>
  );
}

/** 부르기 목록 — 팀 참모 · 사람 · 그 사람 참모 */
export function MentionMenu({ items, sel, onPick }: { items: MentionPick[]; sel: number; onPick: (m: MentionPick) => void }) {
  if (!items.length) return null;
  return (
    <div className="tmx-mlist" role="listbox" aria-label={tr('부르기', 'Mention')}>
      {items.map((m, i) => (
        <Fragment key={m.insert}>
          {/* 내 참모 묶음 머리 — 여기서 고른 말은 팀이 아니라 그 참모 입력칸으로 간다 */}
          {m.kind === 'mine' && items[i - 1]?.kind !== 'mine' && <span className="tmx-mcap">{tr('내 참모', 'My assistants')}</span>}
          {/* 팀 참모 묶음 머리(팀이 만든 것 + 기본) — 사람과 갈라 보이게(시안 team-agent M1) */}
          {m.kind === 'agent' && i === 0 && <span className="tmx-mcap">{tr('팀 참모', 'Team agents')}</span>}
          <button role="option" aria-selected={i === sel} className={`tmx-mrow ${i === sel ? 'on' : ''}`} onMouseDown={(e) => { e.preventDefault(); onPick(m); }}>
            {m.kind === 'mine' && m.orch ? <OrchPickRow o={m.orch} size={24} /> : <>
              {m.kind === 'agent' && m.agent ? <AgentFace def={m.agent} size={24} /> : m.kind === 'helper' ? <HelperFace size={24} /> : <Person name={m.name} color={personColor(m.name)} size={24} />}
              <b>{m.label}</b>
            </>}
            {m.kind === 'helper' && <span>{tr('팀 전체를 보고 답해요', 'Answers with the whole team in view')}</span>}
            {m.kind === 'agent' && m.agent && <span>{[m.agent.blurb, m.agent.model].filter(Boolean).join(' · ')}</span>}
          </button>
        </Fragment>
      ))}
    </div>
  );
}

