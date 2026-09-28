import type { Activity } from '../domain/activity';
import type { Session } from '../domain/session';
import type { ActivityStatus } from '../domain/status';
import { splitCards, type TaskCard } from '../domain/tasks';
import { useRef, useState, type ReactNode } from 'react';
import { assistant, tr } from '../i18n';

export type SessionActivity = { session: Session; activity: Activity; status: ActivityStatus };

// label 은 화면 글자(언어 따라), cls 는 CSS 클래스(번역 안 함)
const STATE: Record<ActivityStatus, { readonly label: string; cls: string }> = {
  asks: { get label() { return tr('답 필요', 'Needs reply'); }, cls: 'needsInput' },
  blocked: { get label() { return tr('확인창', 'Prompt'); }, cls: 'needsInput' },
  working: { get label() { return tr('작업 중', 'Working'); }, cls: 'working' },
  done: { get label() { return tr('끝남', 'Done'); }, cls: 'replied' },
  idle: { get label() { return tr('대기', 'Idle'); }, cls: 'done' },
  stale: { get label() { return tr('쉼', 'Resting'); }, cls: 'done' },
};



/** 접었다 펴는 구역 머리 — 이름 · 개수 · (접힌 구역만) 펼침 표시 */
export function Sec({ title, count, open, onToggle, tone }: { title: string; count: number; open?: boolean; onToggle?: () => void; tone?: string }) {
  const body = (
    <>
      <span>{title}</span>
      <span className="tp-count">{count}</span>
      {onToggle && <span className="tp-fold">{open ? tr('접기', 'Hide') : tr('펼치기', 'Show')}</span>}
    </>
  );
  return onToggle ? (
    <button className={`tasks-sec fold ${tone ?? ''}`} onClick={onToggle}>{body}</button>
  ) : (
    <div className={`tasks-sec ${tone ?? ''}`}>{body}</div>
  );
}

/** 한 줄 목록 — 상태 점 · 굵은 이름 · 한 줄 설명 · 시간. 카드는 결정 대기에만 쓴다(급한 게 눈에 띄게) */
export function Row({ dot, name, line, sub, when, onClick, dim }: { dot: string; name: string; line: string; sub?: string; when: string; onClick: () => void; dim?: boolean }) {
  return (
    <button className={`trow ${dim ? 'dim-row' : ''}`} onClick={onClick}>
      <span className={`tdot ${dot}`} />
      <span className="tmain">
        <span className="thead"><b>{name}</b><span className="tline">{line}</span></span>
        {sub && <span className="tsub">{sub}</span>}
      </span>
      <span className="twhen">{when}</span>
    </button>
  );
}

type Props = { width: number; onWidth: (w: number) => void; cards: TaskCard[]; activities: SessionActivity[]; onOpen: (target: string) => void; /** 맨 위 리뷰(머지 전에 볼 것·오늘 넣은 것) */ top?: ReactNode; /** 맨 아래 자동 허용 기록 */ bottom?: ReactNode; /** 주인 잃은 일 줄 아래 버튼(이어서 켜기·끝난 걸로) */ orphanActions?: (c: TaskCard) => ReactNode };

const hm = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString(tr('ko-KR', 'en-US'), { hour: '2-digit', minute: '2-digit' });
};

/**
 * 작업 패널 — 위에서 아래로 급한 순: 결정 대기(카드) → 진행 중(시킨 일) → 세션 → 끝난 일(오늘 것만, 접힘) → 자동 허용 기록(접힘).
 * 쉬는 세션(24시간 무활동)도 접는다
 */
/**
 * 왼쪽 가장자리를 끌어 폭 조절 (220~560). 끄는 동안 포인터를 손잡이에 붙잡아 둔다(pointer capture) —
 * 왼쪽으로 끌면 터미널 위를 지나가는데, 터미널(xterm)이 마우스 이동을 가로채서 창 전체 리스너로는 못 받았다
 */
export function Grip({ width, onWidth, min = 220, max = 560 }: { width: number; onWidth: (w: number) => void; min?: number; max?: number }) {
  // 폭이 바뀔 때마다 다시 그려지니 끄는 상태는 ref 에 (일반 변수면 한 칸 움직이고 멈춘다)
  const drag = useRef({ x0: 0, w0: 0, on: false }).current;
  return (
    <div
      className="tasks-grip"
      title={tr('끌어서 폭 조절', 'Drag to resize')}
      onPointerDown={(e) => {
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        Object.assign(drag, { x0: e.clientX, w0: width, on: true });
        document.body.classList.add('resizing');
      }}
      onPointerMove={(e) => {
        if (drag.on) onWidth(Math.min(max, Math.max(min, drag.w0 + (drag.x0 - e.clientX))));
      }}
      onPointerUp={(e) => {
        drag.on = false;
        e.currentTarget.releasePointerCapture(e.pointerId);
        document.body.classList.remove('resizing');
      }}
    />
  );
}

export function TaskPanel({ width, onWidth, cards, activities, onOpen, top, bottom, orphanActions }: Props) {
  const [showDone, setShowDone] = useState(false);
  const [showStale, setShowStale] = useState(false);
  const { active, orphaned, doneToday, hidden } = splitCards(cards, Date.now());
  const live = activities.filter((a) => a.status !== 'stale');
  const stale = activities.filter((a) => a.status === 'stale');
  const sessionRow = ({ session: s, activity: a, status }: SessionActivity) => (
    <Row
      key={s.id}
      dot={STATE[status].cls}
      name={s.workspace ? `${s.project} / ${s.workspace}` : s.project}
      line={STATE[status].label}
      sub={a.reply?.text ?? a.prompt?.text}
      when={hm(a.reply?.ts ?? a.prompt?.ts ?? '')}
      onClick={() => onOpen(s.id)}
      dim={status === 'stale'}
    />
  );
  return (
    // 폭을 딱 고정 — 안 그러면 줄바꿈 없는 긴 글(끝난 일 제목 등)만큼 패널이 스스로 늘어나고, 끌어도 그 밑으로 안 줄었다
    <aside className="tasks" style={{ flex: `0 0 ${width}px`, width, minWidth: width, maxWidth: width }}>
      <Grip width={width} onWidth={onWidth} />
      <div className="panel-head">
        <b>{tr('작업', 'Tasks')}</b>
        <span className="dim">⌘J</span>
      </div>
      <div className="tasks-list">
        {top}

        <Sec title={tr('진행 중', 'In progress')} count={active.length} />
        {active.length === 0 && <div className="tempty">{tr(`${assistant()}가 시킨 일 중 안 끝난 게 없어`, `Nothing ${assistant()} delegated is still open`)}</div>}
        {active.map((c) => (
          <Row key={c.id} dot={c.status} name={c.target} line={c.title} sub={c.note} when={hm(c.updatedAt)} onClick={() => onOpen(c.target)} />
        ))}

        {orphaned.length > 0 && <Sec title={tr('주인 잃은 일', 'Orphaned tasks')} count={orphaned.length} tone="hot" />}
        {orphaned.map((c) => (
          <div key={c.id} className="orphan">
            <Row dot={c.status} name={c.target} line={c.title} sub={c.note} when={hm(c.updatedAt)} onClick={() => onOpen(c.target)} />
            {orphanActions?.(c)}
          </div>
        ))}

        <Sec title={tr('세션', 'Sessions')} count={live.length} />
        {live.map(sessionRow)}
        {stale.length > 0 && <Sec title={tr('쉬는 세션', 'Resting sessions')} count={stale.length} open={showStale} onToggle={() => setShowStale((v) => !v)} />}
        {showStale && stale.map(sessionRow)}

        <Sec title={tr('오늘 끝난 일', 'Done today')} count={doneToday.length} open={showDone} onToggle={() => setShowDone((v) => !v)} />
        {showDone && doneToday.map((c) => (
          <Row key={c.id} dot={c.status} name={c.target} line={c.title} sub={c.note} when={hm(c.updatedAt)} onClick={() => onOpen(c.target)} dim />
        ))}
        {showDone && hidden > 0 && <div className="tempty">{tr(`어제 이전에 끝났거나 오래된 ${hidden}개는 숨김`, `${hidden} older items hidden`)}</div>}

        {bottom}
      </div>
    </aside>
  );
}
