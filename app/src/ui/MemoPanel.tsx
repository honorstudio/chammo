// 세션 메모 — ⌘M 으로 창 위에 뜬다. 지금 뭐 하는지·보낼 프롬프트 초안·왜 그렇게 정했는지를 프로젝트별로 쌓는다.
// Enter 저장 · ⌥/Shift+Enter 줄바꿈 · Esc 닫기. 항목마다 세션에 보내기(입력칸에 글자만, Enter 는 직접)·복사·삭제
import { useEffect, useRef, useState } from 'react';
import type { MemoItem } from '../domain/memo';
import { COMMON, shouldGroup } from '../domain/lessons';
import { IconCheck, IconClose, IconCopy, IconSend, IconTrash } from './Icons';
import { assistant, josa, tr } from '../i18n';

type Props = {
  project: string;
  items: MemoItem[];
  onAdd: (text: string) => Promise<void>;
  onSend: (text: string) => void;
  onCopy: (text: string) => void;
  onRemove: (item: MemoItem) => void;
  onClose: () => void;
  /** '교훈' 탭 — 이 프로젝트 교훈과 모든 프로젝트 공통 교훈(참모 지시에 붙는다) */
  lessons?: { mine: string[]; common: string[] };
  onRemoveLesson?: (name: string, lesson: string) => void;
  onPromoteLesson?: (lesson: string) => void;
  /** 교훈이 많을 때 [스킬로 묶기] — 참모에게 묶음 제안을 부탁한다(사람은 결정 대기함 카드로 고른다) */
  onGroupLessons?: () => void;
};

export function MemoPanel({ project, items, onAdd, onSend, onCopy, onRemove, onClose, lessons, onRemoveLesson, onPromoteLesson, onGroupLessons }: Props) {
  const [tab, setTab] = useState<'memo' | 'lessons'>('memo');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  // 삭제는 두 번 눌러야 — 첫 번째는 3초 동안 '한 번 더'
  const [armed, setArmed] = useState<number | null>(null);
  useEffect(() => {
    if (armed === null) return;
    const t = setTimeout(() => setArmed(null), 3000);
    return () => clearTimeout(t);
  }, [armed]);
  const input = useRef<HTMLTextAreaElement>(null);
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => input.current?.focus(), []);
  // 입력칸은 글 길이만큼 늘어난다(최대 높이는 CSS) — 줄바꿈·긴 줄 둘 다
  useEffect(() => {
    const el = input.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight + 2}px`;
  }, [text]);
  // 최근 것이 아래 — 열리거나 새로 쌓이면 맨 아래로
  useEffect(() => { if (list.current) list.current.scrollTop = list.current.scrollHeight; }, [items.length]);

  // 보낸 프롬프트도 기록으로 남게 — 보내기는 저장하고 나서
  const save = async (thenSend = false) => {
    const t = text.trim();
    if (!t || busy) return;
    setBusy(true);
    try {
      await onAdd(t);
      setText('');
      if (thenSend) onSend(t);
    } finally {
      setBusy(false);
    }
  };
  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    } else if (e.key === 'Enter' && !e.shiftKey && !e.altKey) {
      e.preventDefault();
      void save();
    }
  };

  return (
    <div className="memo" onMouseDown={(e) => e.stopPropagation()}>
      <div className="memo-head">
        {lessons ? (
          <span className="memo-tabs" role="tablist">
            <button role="tab" aria-selected={tab === 'memo'} className={tab === 'memo' ? 'on' : ''} onClick={() => setTab('memo')}>{tr('메모', 'Notes')}</button>
            <button role="tab" aria-selected={tab === 'lessons'} className={tab === 'lessons' ? 'on' : ''} onClick={() => setTab('lessons')}>
              {tr('교훈', 'Lessons')}{lessons.mine.length > 0 && <span className="dim"> {lessons.mine.length}</span>}
            </button>
          </span>
        ) : <b>{tr('메모', 'Notes')}</b>}
        <span className="dim">{project}</span>
        <button className="ib memo-close" title={tr('닫기 (Esc)', 'Close (Esc)')} aria-label={tr('닫기', 'Close')} onClick={onClose}><IconClose /></button>
      </div>
      {tab === 'lessons' && lessons ? (
        <LessonList project={project} lessons={lessons} onRemove={onRemoveLesson} onPromote={onPromoteLesson} onGroup={onGroupLessons} />
      ) : (<>
      <div className="memo-list" ref={list}>
        {items.length === 0 && <div className="memo-empty">{tr('아직 없어 — 지금 뭐 하는지, 보낼 프롬프트, 왜 그렇게 정했는지 적어 둬', "Nothing yet — jot down what you're doing, prompts to send, and why you decided things")}</div>}
        {items.map((it, i) => (
          <div key={i} className="memo-item">
            <span className="memo-ts">{it.ts}</span>
            <div className="memo-text">{it.text}</div>
            <span className="memo-acts">
              <button className="ib" title={tr('세션에 보내기 — 입력칸에 넣기만, Enter 는 직접', 'Send to session — only fills the input, press Enter yourself')} aria-label={tr('세션에 보내기', 'Send to session')} onClick={() => onSend(it.text)}><IconSend /></button>
              <button className="ib" title={tr('복사', 'Copy')} aria-label={tr('복사', 'Copy')} onClick={() => onCopy(it.text)}><IconCopy /></button>
              <button
                className={`ib danger ${armed === i ? 'armed' : ''}`}
                title={armed === i ? tr('한 번 더 누르면 삭제', 'Click again to delete') : tr('삭제', 'Delete')}
                aria-label={armed === i ? tr('한 번 더 누르면 삭제', 'Click again to delete') : tr('삭제', 'Delete')}
                onClick={() => { if (armed === i) { setArmed(null); onRemove(it); } else setArmed(i); }}
              >
                <IconTrash />
              </button>
              {armed === i && <span className="memo-armed">{tr('한 번 더', 'Again')}</span>}
            </span>
          </div>
        ))}
      </div>
      <div className="memo-input">
        <textarea
          ref={input}
          className="inp"
          rows={3}
          placeholder={tr('새 메모 — Enter 저장 · ⌥Enter 줄바꿈 · Esc 닫기', 'New note — Enter to save · ⌥Enter for new line · Esc to close')}
          value={text}
          disabled={busy}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKey}
        />
        <div className="memo-input-acts">
          <button className="ib" title={tr('저장하고 세션에 보내기', 'Save and send to session')} aria-label={tr('저장하고 세션에 보내기', 'Save and send to session')} disabled={busy || !text.trim()} onClick={() => void save(true)}><IconSend /></button>
          <button className="ib pri" title={tr('저장 (Enter)', 'Save (Enter)')} aria-label={tr('저장', 'Save')} disabled={busy || !text.trim()} onClick={() => void save()}><IconCheck /></button>
        </div>
      </div>
      </>)}
    </div>
  );
}

/**
 * 교훈 목록 — 쌓이기만 하면 참모 지시가 무거워진다. 끝난 할 일·틀린 건 지우고(두 번 눌러), 여러 프로젝트에 통하는 건 공통으로.
 * 지우면 프로젝트 CLAUDE.local.md 에 복사된 같은 줄도 빠진다
 */
function LessonList({ project, lessons, onRemove, onPromote, onGroup }: {
  project: string;
  lessons: { mine: string[]; common: string[] };
  onRemove?: (name: string, lesson: string) => void;
  onPromote?: (lesson: string) => void;
  onGroup?: () => void;
}) {
  const [armed, setArmed] = useState<string | null>(null);
  useEffect(() => {
    if (armed === null) return;
    const t = setTimeout(() => setArmed(null), 3000);
    return () => clearTimeout(t);
  }, [armed]);
  const del = (name: string, l: string) => {
    const k = `${name}\n${l}`;
    if (armed === k) { setArmed(null); onRemove?.(name, l); } else setArmed(k);
  };
  const row = (name: string, l: string, promote: boolean) => {
    const k = `${name}\n${l}`;
    return (
      <div key={k} className="memo-item lesson-item">
        <div className="memo-text">{l}</div>
        <span className="memo-acts">
          {promote && <button className="mini" title={tr('모든 프로젝트 지시에 붙게', 'Attach to every project')} onClick={() => onPromote?.(l)}>{tr('공통으로', 'Make common')}</button>}
          <button className={`mini ${armed === k ? 'danger' : ''}`} onClick={() => del(name, l)}>
            {armed === k ? tr('한 번 더', 'Again') : tr('지우기', 'Delete')}
          </button>
        </span>
      </div>
    );
  };
  return (
    <div className="memo-list">
      <div className="lesson-note dim">{tr(`${josa(assistant(), '이', '가')} 이 프로젝트에 일을 시킬 때 지시 끝에 붙는 것. 끝난 할 일·중복은 지워 줘`, 'Attached to the end of every instruction sent to this project. Delete finished to-dos and duplicates')}</div>
      {onGroup && shouldGroup(project, lessons.mine.length) && (
        <div className="lesson-group">
          <button className="mini" title={tr(`주제별로 묶어 필요할 때만 열리는 스킬로 — ${josa(assistant(), '이', '가')} 묶음을 카드로 물어`, `Group by topic into skills that open only when needed — ${assistant()} asks you with cards`)} onClick={onGroup}>
            {tr('스킬로 묶기', 'Group into skills')}
          </button>
        </div>
      )}
      {lessons.mine.length === 0 && <div className="memo-empty">{tr('이 프로젝트 교훈은 아직 없어', 'No lessons for this project yet')}</div>}
      {lessons.mine.map((l) => row(project, l, true))}
      {lessons.common.length > 0 && <div className="lesson-sec dim">{tr(`공통 ${lessons.common.length} — 모든 프로젝트`, `Common ${lessons.common.length} — every project`)}</div>}
      {lessons.common.map((l) => row(COMMON, l, false))}
    </div>
  );
}
