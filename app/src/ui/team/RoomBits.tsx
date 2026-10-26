// 메신저 방 화면 v2 조각(시안 msg-rooms v2) — 부르기 글·반응 칩·반응 고르기·파일 풍선·부르기 목록·팀 참모 얼굴.
// 강조는 옅은 면·전체 테두리·굵기(왼쪽 색 띠 없음). 반응 표식은 이모지 대신 Icons.tsx 의 직접 그린 SVG
import { useState } from 'react';
import { fileSize, mentionParts, type MentionPick, type Reaction, type TeamFile } from '../../domain/teamChat';
import { tr } from '../../i18n';
import { IconClose, IconDoc, IconLock, IconReactAdd, REACT_MARKS } from '../Icons';
import { Face, Person } from './TeamFaces';
import { personColor } from '../../domain/teamChat';
import './team.css';

const markOf = (k: string) => REACT_MARKS.find((m) => m.key === k);
const markName = (k: string) => { const m = markOf(k); return m ? tr(m.ko, m.en) : k; };

/** 글 — 아는 이름의 @부르기만 칩으로, 내 이름은 진하게 */
export function MentionText({ text, names, myName }: { text: string; names: string[]; myName: string }) {
  return <>{mentionParts(text, names, myName).map((p, i) => (p.t === 'text' ? <span key={i}>{p.s}</span> : <span key={i} className={`tmx-mn ${p.me ? 'me' : ''}`}>{p.s}</span>))}</>;
}

/** 팀 참모 얼굴 — 눈 셋(내 참모·남의 참모와 갈리게) */
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

/** 파일 풍선 — 이름·크기·자물쇠(종단 암호). 누르면 스페이스에서 연다(보관함과 같은 길), 오른쪽 클릭 = 다른 앱으로 열기·저장 */
export function FileBubbles({ files, me, onOpen, onMenu }: { files: TeamFile[]; me?: boolean; onOpen?: (f: TeamFile) => void; onMenu?: (e: React.MouseEvent, f: TeamFile) => void }) {
  return (
    <div className="tmx-files">
      {files.map((f) => {
        const inner = <><span className="tmx-file-ic"><IconDoc /></span><span className="tmx-file-tx"><b title={f.name}>{f.name}</b><span><IconLock />{fileSize(f.size)}</span></span></>;
        return onOpen
          ? <button type="button" key={f.id} className={`tmx-file ${me ? 'me' : ''}`} title={tr(`${f.name} 열기`, `Open ${f.name}`)} onClick={(e) => { e.stopPropagation(); onOpen(f); }} onContextMenu={onMenu ? (e) => { e.preventDefault(); onMenu(e, f); } : undefined}>{inner}</button>
          : <div key={f.id} className={`tmx-file ${me ? 'me' : ''}`}>{inner}</div>;
      })}
    </div>
  );
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
        <button key={m.insert} role="option" aria-selected={i === sel} className={`tmx-mrow ${i === sel ? 'on' : ''}`} onMouseDown={(e) => { e.preventDefault(); onPick(m); }}>
          {m.kind === 'helper' ? <HelperFace size={24} /> : m.kind === 'person' ? <Person name={m.name} color={personColor(m.name)} size={24} /> : <Face color={personColor(m.name)} size={24} />}
          <b>{m.label}</b>
          {m.kind === 'helper' && <span>{tr('팀 전체를 보고 답해요', 'Answers with the whole team in view')}</span>}
        </button>
      ))}
    </div>
  );
}

