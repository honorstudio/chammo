// 메신저 방 화면 v2 조각(시안 msg-rooms v2) — 부르기 글·반응 칩·반응 고르기·파일 풍선·부르기 목록·팀 참모 얼굴.
// 강조는 옅은 면·전체 테두리·굵기(왼쪽 색 띠 없음). 반응 표식은 이모지 대신 Icons.tsx 의 직접 그린 SVG
import { Fragment, useEffect, useState, useRef } from 'react';
import { fileSize, mentionParts, type MentionPick, type Reaction, type TeamFile } from '../../domain/teamChat';
import { tr } from '../../i18n';
import { IconClose, IconDoc, IconLock, IconReactAdd, REACT_MARKS } from '../Icons';
import { Person } from './TeamFaces';
import { personColor, plainText } from '../../domain/teamChat';
import { extOf, thumbKind } from '../../domain/teamLocker';
import { attNote } from '../../domain/teamAttach';
import { linkParts } from '../../domain/links';
import { OrchPickRow } from './OrchPick';
import { DownActs, DownBar, DownLine, type DownApi } from './TeamDownBits';
import { agentColor } from '../../domain/teamAgent';
import './team.css';
import './teamAgent.css';

const markOf = (k: string) => REACT_MARKS.find((m) => m.key === k);
const markName = (k: string) => { const m = markOf(k); return m ? tr(m.ko, m.en) : k; };

/** 글 — 아는 이름의 @부르기만 칩으로, 내 이름은 진하게. 웹 주소는 링크(newTab = 폰, 새 탭으로) */
export function MentionText({ text, names, myName, newTab, shown }: { text: string; names: string[]; myName: string; newTab?: boolean; /** 계정 이름 → 프로필 이름(teamChat mentionParts) */ shown?: Map<string, string> }) {
  return <>{mentionParts(text, names, myName, shown).map((p, i) => (p.t === 'text' ? <span key={i}><Linked s={p.s} newTab={newTab} /></span> : <span key={i} className={`tmx-mn ${p.me ? 'me' : ''}`}>{p.s}</span>))}</>;
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

/** 줄 앞 작은 첫 장(32px) — 팀 홈 최근 파일·폰 팀 보관함 줄(11-01 시안 2). 그림이 오면 첫 장, 못 그리면 확장자 표(className 그대로).
 *  get 은 렌더마다 새 함수라 id·이름이 바뀔 때만 다시 받는다(썸네일 길이 파일마다 한 번만 받아 기억한다) */
export function FileMini({ className, id, name, get, lazy }: { className: string; id: string; name: string; get?: () => Promise<string | null>; lazy?: boolean }) {
  const [src, setSrc] = useState<string | null>(null);
  const { node, seen } = useSeen(!!lazy);
  useEffect(() => {
    setSrc(null);
    if (!get || !seen) return;
    let live = true;
    get().then((u) => { if (live) setSrc(u); }, () => {});
    return () => { live = false; };
  }, [id, name, !!get, seen]); // eslint-disable-line react-hooks/exhaustive-deps
  if (src) return <span ref={node as React.RefObject<HTMLSpanElement>} className={`${className} file-mini`} aria-hidden="true"><img src={src} alt="" draggable={false} onError={() => setSrc(null)} /></span>;
  return <span ref={node as React.RefObject<HTMLSpanElement>} className={className} aria-hidden="true">{extOf(name) || tr('파일', 'File')}</span>;
}

/** lazy = 화면에 들어올 때까지 기다린다(폰 — 썸네일마다 맥이 내려받으니 파일 97개 대화를 열 때 다 받지 않게). 한 번 보면 계속 true */
function useSeen(lazy: boolean) {
  const [seen, setSeen] = useState(!lazy || typeof IntersectionObserver === 'undefined');
  const node = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const el = node.current;
    if (seen || !el) return;
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) setSeen(true); }, { root: el.closest('.tmx-msgs'), rootMargin: '300px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, [seen]);
  return { node, seen };
}

/** 썸네일 길 — 데스크톱은 풀어 둔 그림·PDF 첫 장(teamApi teamFileThumb), 폰은 맥이 줄인 JPEG. 못 그리면 null */
export type ThumbOf = { get: (f: TeamFile) => Promise<string | null>; forget?: (f: TeamFile) => void };

/** 파일 풍선 — 그림은 썸네일 크게, PDF 는 첫 장을 아이콘 자리에, 그 밖은 아이콘(10-28 사용자 "썸네일 없이 빈 네모").
 *  이름·크기·자물쇠(종단 암호). 누르면 스페이스에서 연다(보관함과 같은 길), 오른쪽 클릭 = 다른 앱으로 열기·저장
 *  canOpen = 폰 — 열 수 있는 파일만 버튼(열 길이 없는 칸은 누를 수 있게 보이지 않는다), 썸네일이 떴는지와 상관없다(11-06). lazy = 폰 — 화면에 들어온 칸만 썸네일을 받는다 */
/** 받기(데스크톱만) — 받기 아이콘·진행 막대·폴더에서 보기·열기(TeamDownBits) */
export type FileDown = { api: DownApi; save: (f: TeamFile) => void };

export function FileBubbles({ files, me, onOpen, onMenu, thumb, canOpen, lazy, down }: { files: TeamFile[]; me?: boolean; onOpen?: (f: TeamFile) => void; onMenu?: (e: React.MouseEvent, f: TeamFile) => void; thumb?: ThumbOf; canOpen?: (f: TeamFile) => boolean; lazy?: boolean; down?: FileDown }) {
  return (
    <div className="tmx-files">
      {files.map((f) => <FileBubble key={f.id} f={f} me={me} onOpen={onOpen} onMenu={onMenu} thumb={thumb} canOpen={canOpen} lazy={lazy} down={down} />)}
    </div>
  );
}

function FileBubble({ f, me, onOpen, onMenu, thumb, canOpen, lazy, down }: { f: TeamFile; me?: boolean; onOpen?: (f: TeamFile) => void; onMenu?: (e: React.MouseEvent, f: TeamFile) => void; thumb?: ThumbOf; canOpen?: (f: TeamFile) => boolean; lazy?: boolean; down?: FileDown }) {
  const name = plainText(f.name); // 보낸 사람이 봉한 글 그대로라 보이지 않는 글자를 뺀다(글자 방향 뒤집기로 .exe 를 .pdf 처럼, H-1)
  const kind = thumb ? thumbKind(f.name, f.size) : null;
  const [src, setSrc] = useState<string | null>(null);
  const { node, seen } = useSeen(!!lazy);
  const hold = node as React.RefObject<HTMLButtonElement & HTMLDivElement>; // 칸이 단추든 div 든 같은 자리
  useEffect(() => {
    setSrc(null);
    if (!kind || !thumb || !seen) return;
    let live = true;
    thumb.get(f).then((u) => { if (live) setSrc(u); }, () => {});
    return () => { live = false; };
  }, [f.id, f.team, kind, seen]); // eslint-disable-line react-hooks/exhaustive-deps
  const forget = (x: TeamFile) => thumb?.forget?.(x);
  const d = down?.api.of(f.id);
  const pic = kind === 'image' && !!src;
  const img = src && <img src={src} alt="" draggable={false} onError={() => { forget(f); setSrc(null); }} />;
  const inner = (
    <>
      {pic && <span className="tmx-file-pic">{img}</span>}
      <span className="tmx-file-row">
        {!pic && <span className={`tmx-file-ic ${kind === 'page' && src ? 'pg' : ''}`}>{kind === 'page' && src ? img : <IconDoc />}</span>}
        <span className="tmx-file-tx"><b title={name}>{name}</b><span><DownLine d={d} normal={<><IconLock />{fileSize(f.size)}</>} /></span></span>
      </span>
      <DownBar d={d} />
    </>
  );
  const cls = `tmx-file ${me ? 'me' : ''} ${pic ? 'has-pic' : ''}`;
  const body = onOpen && (!canOpen || canOpen(f))
    ? <button ref={hold} type="button" className={cls} title={tr(`${name} 열기`, `Open ${name}`)} onClick={(e) => { e.stopPropagation(); onOpen(f); }} onContextMenu={onMenu ? (e) => { e.preventDefault(); onMenu(e, f); } : undefined}>{inner}</button>
    : <div ref={hold} className={cls}>{inner}</div>;
  if (!down) return body;
  // 말풍선이 통째로 단추라 받기 아이콘은 겹친 형제(.tmx-file-wrap) — 단추 안 단추를 안 만든다
  return (
    <div className={`tmx-file-wrap ${pic ? 'pic' : ''} ${d?.state === 'going' ? 'going' : ''} ${d?.state === 'done' ? 'two' : ''}`}>
      {body}
      <DownActs d={d} api={down.api} onSave={() => down.save(f)} onRetry={d?.mode === 'open' && onOpen ? () => onOpen(f) : undefined} />
    </div>
  );
}

/** 보내기 전 붙인 파일 칩 — 올리는 중이면 이름만 흐리게 */
export function Attachments({ list, onRemove }: { list: { key: string; name: string; size?: number; busy?: boolean; wait?: boolean; pct?: number | null; err?: string }[]; onRemove: (key: string) => void }) {
  if (!list.length) return null;
  return (
    <div className="tmx-atts">
      {list.map((a) => (
        <span key={a.key} className={`tmx-att ${a.busy || a.wait ? 'busy' : ''} ${a.err ? 'err' : ''}`} title={a.err}>
          <span className="tmx-file-ic s"><IconDoc /></span><b>{a.name}</b>
          <span>{attNote(a, a.pct ?? null)}</span>
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
          {m.kind === 'agent' && i === 0 && <span className="tmx-mcap">{tr('팀 참모 기술', 'Team assistant skills')}</span>}
          <button role="option" aria-selected={i === sel} className={`tmx-mrow ${i === sel ? 'on' : ''}`} onMouseDown={(e) => { e.preventDefault(); onPick(m); }}>
            {m.kind === 'mine' && m.orch ? <OrchPickRow o={m.orch} size={24} /> : <>
              {m.kind === 'agent' && m.agent ? <AgentFace def={m.agent} size={24} /> : m.kind === 'helper' ? <HelperFace size={24} /> : <Person name={m.label} color={personColor(m.name)} size={24} />}
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

