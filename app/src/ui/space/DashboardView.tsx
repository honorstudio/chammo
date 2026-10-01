import { invoke } from '@tauri-apps/api/core';
import { useEffect, useRef, useState } from 'react';
import type { DashFile } from '../../domain/dashboard';
import { docUrl, kindOf } from '../../domain/reader';
import { tr } from '../../i18n';
import { Preview } from './Preview';
import { dragPath } from './dragPath';
import { IconChat, IconClose, IconTerminal } from '../Icons';

/** 세션마다 지금 하는 일 한 줄(대시보드 맨 아래 터미널 줄) */
export type LiveLine = { status: 'run' | 'ask' | 'wait'; line: string };
export type DashLine = { id: string; name: string; status: LiveLine['status'] | 'done'; line: string; /** 터미널처럼 몇 줄(대화 기록 꼬리) */ tail?: string[] };

const fileName = (p: string) => (p.startsWith('data:') ? tr('붙인 그림', 'Attached image') : p.split('/').pop() ?? p);
const hhmm = (ts: string) => { const d = new Date(ts); return Number.isNaN(d.getTime()) ? '' : `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
const isImage = (p: string) => p.startsWith('data:image') || kindOf(p) === 'image';

// md·글 앞부분 — 썸네일에 몇 줄. 한 번 읽은 건 기억
const excerpts = new Map<string, string>();
function useExcerpt(path: string, on: boolean) {
  const [t, setT] = useState(() => excerpts.get(path) ?? '');
  useEffect(() => {
    if (!on || excerpts.has(path)) return;
    void invoke<string>('read_doc_text', { path }).then((s) => {
      const x = s.replace(/^---[\s\S]*?---\s*/, '').replace(/[#>*`_|-]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 220);
      excerpts.set(path, x);
      setT(x);
    }, () => {});
  }, [path, on]);
  return t;
}

// HTML 시안 썸네일 = QuickLook 이 그린 그림(한 번 만든 건 기억). 예전엔 카드마다 시안을 통째로 띄워
// 참모를 바꿀 때마다 화면이 잠깐 멈췄다(2026-09-30 사용자 "전환 딜레이")
const qlThumbs = new Map<string, Promise<string>>();
function useQlThumb(path: string, on: boolean) {
  const [png, setPng] = useState<string | null>(null);
  useEffect(() => {
    if (!on) return;
    let alive = true;
    if (!qlThumbs.has(path)) qlThumbs.set(path, invoke<string>('ql_thumb', { path }));
    qlThumbs.get(path)!.then((p) => { if (alive) setPng(p); }, () => {});
    return () => { alive = false; };
  }, [path, on]);
  return png;
}

/** 파일 카드 썸네일 — 그림은 그대로, HTML 시안은 첫 화면 그림, md·글은 앞부분 */
function Thumb({ f }: { f: DashFile }) {
  const kind = f.path.startsWith('data:') ? 'image' : kindOf(f.path);
  const text = useExcerpt(f.path, kind === 'md' || kind === 'text');
  const png = useQlThumb(f.path, kind === 'html' || kind === 'other' || kind === 'office');
  if (isImage(f.path)) return <img src={f.path.startsWith('data:') ? f.path : docUrl(f.path)} alt="" loading="lazy" />;
  if (png) return <img className="cv-thumb-ql" src={docUrl(png)} alt="" />;
  if (kind === 'md' || kind === 'text') return <p className="cv-thumb-text">{text}</p>;
  return <span className="cv-thumb-kind">{(f.path.match(/\.([a-z0-9]+)$/i)?.[1] ?? kind).toUpperCase()}</span>;
}

/**
 * 세션 칸 — 머리(상태·이름·지금 하는 일) + 터미널처럼 마지막 몇 줄. 누르면 그 자리에서 진짜 터미널로 바뀌고 직접 칠 수 있다
 * (채팅 칸의 채팅↔터미널처럼, 2026-09-30 사용자 "누르면 본체 말고 터미널 뷰로만"). 머리 오른쪽 버튼으로 다시 요약
 */
function Pane({ l, term, live, onToggle, onStop }: { l: DashLine; term?: React.ReactNode; live: boolean; onToggle: () => void; onStop?: () => void }) {
  const word = l.status === 'run' ? tr('일하는 중', 'Working') : l.status === 'ask' ? tr('기다림', 'Waiting') : l.status === 'done' ? tr('끝남', 'Done') : tr('쉼', 'Idle');
  return (
    <div className={`cv-pane ${l.status} ${live ? 'live' : ''}`}>
      <div className="cv-pane-head">
        {l.status === 'run' ? <span className="cv-spin dark" /> : <span className="cv-dot" />}<b>{l.name}</b><em>{word}</em>
        {term !== undefined && (
          <button className="cv-pane-tog" onClick={onToggle} title={live ? tr('요약으로', 'Back to summary') : tr('터미널로 — 직접 칠 수 있다', 'Terminal — type directly')} aria-label={live ? tr('요약으로', 'Summary') : tr('터미널로', 'Terminal')}>
            {live ? <IconChat /> : <IconTerminal />}
          </button>
        )}
        {onStop && l.status !== 'done' && (
          <button className="cv-pane-tog" onClick={onStop} title={tr('세션 끄기', 'Stop session')} aria-label={tr('세션 끄기', 'Stop session')}><IconClose /></button>
        )}
      </div>
      {live && term !== undefined ? <div className="cv-pane-term">{term}</div> : (
        <button className="cv-pane-body" onClick={term !== undefined ? onToggle : undefined} title={l.line}>
          {(l.tail?.length ? l.tail : [l.line || word]).map((t, i) => <span key={i} className={t.startsWith('>') ? 'me' : t.startsWith('  ⎿') ? 'res' : ''}>{t}</span>)}
        </button>
      )}
    </div>
  );
}

/**
 * 대시보드(v8) — 참모든 프로젝트든 같은 모양. 주고받은 파일이 주인공(썸네일 크게, 최근 먼저, 누르면 미리보기),
 * 맨 아래 검은 줄 하나에 세션마다 지금 하는 일(누르면 그 세션 페이지)
 */
export type DashLists = { todo: { text: string; doing?: boolean; by?: string }[]; decisions: string[]; source?: string };

export function DashboardView({ onStop, headAction, onCuration, title, titleNode, color, meta, files, lines, onOpenSession, emptyText, work = false, onOpenDoc, onAttach, term, lists, hint, onSendText, onTitleEdit, aside }: {
  /** 제목 줄 오른쪽 빈 자리(참모 할 일·결정) */
  aside?: React.ReactNode;
  /** 제목 자리에 그릴 것(참모 이름 — 그 자리에서 고치기) */
  titleNode?: React.ReactNode;
  /** 제목 두 번 누르면 이름 바꾸기(참모) */
  onTitleEdit?: () => void;
  onSendText?: (text: string) => Promise<void>;
  onCuration?: (path: string, by?: string) => void;
  /** 제목 아래 알림 칸(누가 시켰는지 모르는 일 등) */
  hint?: React.ReactNode;
  /** 위 목록 — 할 일(세션 할 일 + starter "다음 할 일")·최근 결정(starter) */
  lists?: DashLists;
  /** 세션 칸을 터미널로 바꿨을 때 그릴 진짜 터미널(직접 칠 수 있게) */
  term?: (id: string) => React.ReactNode;
  /** md 는 미리보기 말고 노션식 문서로 */
  onOpenDoc?: (path: string) => void;
  onAttach?: (path: string) => void;
  /** 프로젝트 = 하는 일(세션 터미널)이 주인공, 파일은 아래 작게 — 보여 줄 파일이 거의 없어서(2026-09-30 사용자) */
  work?: boolean;
  title: string;
  color?: string;
  meta?: string;
  files: DashFile[];
  lines: DashLine[];
  /** 세션 칸마다 끄기 버튼 — 확인 창은 부르는 쪽이 */
  onStop?: (id: string) => void;
  /** 머리 오른쪽 버튼(프로젝트 새 세션 등) */
  headAction?: React.ReactNode;
  onOpenSession: (id: string) => void;
  emptyText: string;
}) {
  const [preview, setPreview] = useState<DashFile | null>(null);
  // 주고받은 파일은 두 줄만(한 줄 6개, 좁으면 4개), 나머지는 "더 보기"(2026-09-30 사용자)
  const [more, setMore] = useState(false);
  const grid = useRef<HTMLDivElement>(null);
  const [cols, setCols] = useState(6);
  useEffect(() => {
    const el = grid.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setCols(el.clientWidth < 820 ? 4 : 6));
    ro.observe(el);
    return () => ro.disconnect();
  }, [files.length > 0]); // eslint-disable-line react-hooks/exhaustive-deps
  const visible = more ? files : files.slice(0, cols * 2);
  // 프로젝트(work)는 처음부터 터미널(바로 칠 수 있게), 참모는 처음엔 요약 — 누르면 서로 바뀐다
  const [flip, setFlip] = useState<string[]>([]);
  const toggle = (id: string) => setFlip((v) => (v.includes(id) ? v.filter((x) => x !== id) : [...v, id]));
  // 끝난 세션은 붙여도 빈 화면이라 처음엔 요약(2026-09-30 사용자 "아너 사이트 아무것도 안 뜸")
  const isLive = (id: string) => (work && lines.find((l) => l.id === id)?.status !== 'done') !== flip.includes(id);
  const live = lines.filter((l) => isLive(l.id)).map((l) => l.id);
  const pane = (l: DashLine) => <Pane key={l.id} l={l} term={term ? term(l.id) : undefined} live={isLive(l.id)} onToggle={() => toggle(l.id)} onStop={onStop ? () => onStop(l.id) : undefined} />;
  return (
    <div className="cv-dash">
      <header className="cv-page-head">
        {color && <span className="cv-avatar lg" style={{ background: color }} />}
        <div className="cv-titles"><h1 className={onTitleEdit ? 'editable' : undefined} onDoubleClick={onTitleEdit} title={onTitleEdit ? tr('두 번 눌러 이름 바꾸기', 'Double-click to rename') : undefined}>{titleNode ?? title}</h1>{meta && <p>{meta}</p>}</div>
        {headAction && <div className="cv-head-act">{headAction}</div>}
        {aside && <div className="cv-head-aside">{aside}</div>}
      </header>
      {hint}
      {work ? (
        <>
          {lists && (lists.todo.length > 0 || lists.decisions.length > 0) && (
            <section className="cv-lists">
              <div className="cv-list">
                <div className="cv-h2">{tr('할 일', 'To do')}<span>{lists.todo.length}</span>{lists.source && onOpenDoc && <button className="cv-link" onClick={() => onOpenDoc(lists.source!)}>{tr('starter 열기', 'Open starter')}</button>}</div>
                <ul>{lists.todo.map((t, i) => <li key={i} className={t.doing ? 'doing' : ''}>{t.doing ? <span className="cv-spin" /> : <span className="cv-bullet" />}<span>{t.text}</span>{t.by && <em>{t.by}</em>}</li>)}</ul>
              </div>
              <div className="cv-list">
                <div className="cv-h2">{tr('최근 결정', 'Recent decisions')}<span>{lists.decisions.length}</span></div>
                <ul>{lists.decisions.map((t, i) => <li key={i}><span className="cv-bullet dec" /><span>{t}</span></li>)}</ul>
              </div>
            </section>
          )}
          <section className="cv-work" aria-label={tr('하는 일', 'Work')}>
            <div className="cv-h2">{tr('터미널', 'Terminals')}<span>{lines.length}</span></div>
            <div className="cv-panes big">{lines.map(pane)}</div>
          </section>
          {files.length > 0 && (
            <div className="cv-fstrip">
              <span className="cv-h2 inline">{tr('보여 준 파일', 'Shown files')}</span>
              {files.map((f) => (
                <button key={`${f.path}:${f.ts}`} {...dragPath(f.path)} className="cv-fchip" onClick={() => (onOpenDoc && kindOf(f.path) === 'md' ? onOpenDoc(f.path) : setPreview(f))} title={f.path}>
                  <span className="cv-fchip-th"><Thumb f={f} /></span><b>{fileName(f.path)}</b><span>{hhmm(f.ts)}</span>
                </button>
              ))}
            </div>
          )}
        </>
      ) : (
        <>
          <section className="cv-files" aria-label={tr('주고받은 파일', 'Files')}>
            <div className="cv-h2">{tr('주고받은 파일', 'Files')}<span>{files.length}</span></div>
            {files.length === 0 ? <div className="cv-blank">{emptyText}</div> : (
              <div className={`cv-grid c${cols}`} ref={grid}>
                {visible.map((f) => (
                  <button key={`${f.path}:${f.ts}`} {...dragPath(f.path)} className="cv-card" onClick={() => (onOpenDoc && kindOf(f.path) === 'md' ? onOpenDoc(f.path) : setPreview(f))} title={f.path.startsWith('data:') ? '' : f.path}>
                    <span className="cv-thumb"><Thumb f={f} /></span>
                    <span className="cv-card-body"><b>{fileName(f.path)}</b><span>{f.byName ?? f.by} · {hhmm(f.ts)}</span></span>
                  </button>
                ))}
              </div>
            )}
            {files.length > cols * 2 && (
              <button className="cv-more" onClick={() => setMore((m) => !m)}>{more ? tr('접기', 'Show less') : tr(`더 보기 · ${files.length - cols * 2}개 더`, `Show ${files.length - cols * 2} more`)}</button>
            )}
          </section>
          {lines.length > 0 && <div className={`cv-panes ${live.length ? 'tall' : ''}`}>{lines.map(pane)}</div>}
        </>
      )}
      {preview && <Preview f={preview} onClose={() => setPreview(null)} onAttach={onAttach ? () => onAttach(preview.path) : undefined} onSendText={onSendText} onCuration={onCuration} />}
    </div>
  );
}
