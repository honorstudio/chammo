// 세션 탭(패널 하나로 S4, 사용자 10/12 "추천대로") — 세션 독 칸 '크게'·독 줄 이름·진행 중 칩 머리줄 크게로 가운데 탭에 연다.
// 옛 프로젝트 대시보드(o:/s:/p:)의 네 덩어리를 한 탭에: 머리(점·이름·하는 일·경로·도구·새 세션) / 큰 터미널(바로 쳐서 끼어들기, 브라우저를 쓰면
// 브라우저 크게 + 아래 터미널 — 세션 화면 규칙 그대로) / 오른쪽 할 일·최근 결정(그 프로젝트 starter + 세션 할 일) + 보여 준 파일
import type { ReactNode } from 'react';
import { tr } from '../../i18n';
import type { DashLists } from './DashboardView';

export function SessionPage({ title, mark, meta, path, actions, body, lists, onOpenStarter, shown }: {
  title: string;
  /** 상태 점(StateMark) */
  mark: ReactNode;
  /** 하는 일 한 줄(마지막 줄·상태 말) */
  meta: string;
  path: string;
  /** 머리 오른쪽 — 도구·브라우저 연결·새 세션 */
  actions?: ReactNode;
  /** 큰 터미널(브라우저를 쓰면 브라우저 + 터미널) */
  body: ReactNode;
  lists: DashLists | null;
  onOpenStarter?: () => void;
  /** 이 세션이 보여 준 파일 칩 */
  shown?: ReactNode;
}) {
  const todo = lists?.todo ?? [];
  const dec = lists?.decisions ?? [];
  return (
    <div className="sp-page">
      <header className="sp-head">
        {mark}<b className="sp-title">{title}</b>{meta && <span className="sp-meta">{meta}</span>}<span className="sp-path" title={path}>{path}</span>
        <span className="cv-sp" />{actions}
      </header>
      <div className="sp-body">
        <div className="sp-term">{body}</div>
        <aside className="sp-side" aria-label={tr('할 일·최근 결정', 'To do and decisions')}>
          <section className="sp-box">
            <h3>{tr('할 일', 'To do')}<span className="sp-n">{todo.length}</span>{onOpenStarter && lists?.source && <button className="sp-link" onClick={onOpenStarter}>{tr('starter 열기', 'Open starter')}</button>}</h3>
            {todo.length === 0 ? <p className="sp-empty">{tr('없어요', 'None')}</p> : (
              <ul>{todo.map((t, i) => <li key={i} className={t.doing ? 'doing' : ''}>{t.text}{t.by && <em>{t.by}</em>}</li>)}</ul>
            )}
          </section>
          <section className="sp-box">
            <h3>{tr('최근 결정', 'Recent decisions')}<span className="sp-n">{dec.length}</span></h3>
            {dec.length === 0 ? <p className="sp-empty">{tr('없어요', 'None')}</p> : <ul>{dec.map((t, i) => <li key={i}>{t}</li>)}</ul>}
          </section>
          {shown}
        </aside>
      </div>
    </div>
  );
}
