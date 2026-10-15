import { invoke } from '@tauri-apps/api/core';
import { useEffect, useState } from 'react';
import type { DashFile } from '../../domain/dashboard';
import { docUrl, kindOf } from '../../domain/reader';
import { tr } from '../../i18n';
import { statusWord, type ActivityStatus } from '../../domain/status';
import { IconChat, IconClose, IconMaximize, IconTerminal } from '../Icons';
import { paneStatus, type Live } from '../../domain/agentBrowser';
import { AgentBrowser } from '../AgentBrowser';

// 세션 칸(Pane)·파일 썸네일(Thumb·useQlThumb)·줄 모양 — 옛 대시보드(o:/p:) 화면은 지웠다(패널 하나로 7). 칸은 세션 독이, 썸네일은 보관함·채팅 파일 카드가 쓴다
/** 세션마다 지금 하는 일 한 줄(세션 독 줄) */
/** st = 원래 상태(domain/status) — 말은 statusWord 하나로(메뉴·사무실과 같게) */
export type LiveLine = { status: 'run' | 'ask' | 'wait'; line: string; st?: ActivityStatus };
export type DashLine = { id: string; name: string; status: LiveLine['status']; st?: ActivityStatus; /** 턴을 끝내고 쉬는 세션(살아 있음) — 붙여도 화면이 비어 처음엔 요약 */ finished?: boolean; line: string; /** 터미널처럼 몇 줄(대화 기록 꼬리) */ tail?: string[]; /** 그 세션이 쓰는 브라우저(참모 브라우저 래퍼 상태) — 있으면 칸이 브라우저 화면으로 */ browser?: Live };

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
export function useQlThumb(path: string, on: boolean) {
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
export function Thumb({ f }: { f: DashFile }) {
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
export function Pane({ l, term, live, onToggle, onStop, onBig }: { l: DashLine; term?: React.ReactNode; live: boolean; onToggle: () => void; onStop?: () => void; /** 크게 — 가운데 세션 탭(세션 독) */ onBig?: () => void }) {
  // 브라우저가 사람을 기다리면 '일하는 중'(도구가 도는 중이라) 대신 사람 필요 — 모달을 닫아도 남는다(2026-10-04 QA B2)
  const status = paneStatus(l.status, l.browser);
  const word = status === 'human' ? tr('사람 필요', 'Needs you') : l.st ? statusWord(l.st) : status === 'run' ? tr('일하는 중', 'Working') : status === 'ask' ? tr('기다림', 'Waiting') : tr('쉼', 'Idle');
  // 브라우저를 쓰는 세션이면 칸이 브라우저 화면 + 아래 작은 터미널 띠(AgentBrowser) — 2026-10-03 사용자
  const body = live && term !== undefined ? <div className="cv-pane-term">{term}</div> : (
    <button className="cv-pane-body" onClick={term !== undefined ? onToggle : undefined} title={l.line}>
      {(l.tail?.length ? l.tail : [l.line || word]).map((t, i) => <span key={i} className={t.startsWith('>') ? 'me' : t.startsWith('  ⎿') ? 'res' : ''}>{t}</span>)}
    </button>
  );
  return (
    <div className={`cv-pane ${status === 'human' ? 'ask st-human' : l.status} ${live ? 'live' : ''} ${l.browser ? 'cv-pane-web' : ''}`}>
      <div className="cv-pane-head">
        {status === 'run' ? <span className="cv-spin dark" /> : <span className="cv-dot" />}<b>{l.name}</b><em>{word}</em>
        {term !== undefined && (
          <button className="cv-pane-tog" onClick={onToggle} title={live ? tr('요약으로', 'Back to summary') : tr('터미널로 — 직접 칠 수 있다', 'Terminal — type directly')} aria-label={live ? tr('요약으로', 'Summary') : tr('터미널로', 'Terminal')}>
            {live ? <IconChat /> : <IconTerminal />}
          </button>
        )}
        {onBig && (
          <button className="cv-pane-tog" onClick={onBig} title={tr('크게 — 가운데 탭으로', 'Open large — in a tab')} aria-label={tr('크게', 'Open large')}><IconMaximize /></button>
        )}
        {onStop && (
          <button className="cv-pane-tog" onClick={onStop} title={tr('세션 끄기', 'Stop session')} aria-label={tr('세션 끄기', 'Stop session')}><IconClose /></button>
        )}
      </div>
      {l.browser ? <AgentBrowser live={l.browser}>{body}</AgentBrowser> : body}
    </div>
  );
}

/** 할 일·최근 결정(세션 탭 오른쪽) — 세션 할 일 + starter "다음 할 일"·"최근 결정" */
export type DashLists = { todo: { text: string; doing?: boolean; by?: string }[]; decisions: string[]; source?: string };
