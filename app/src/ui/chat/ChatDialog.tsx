// 세션 터미널에 뜬 선택 창을 채팅 안에 — 질문과 선택지를 버튼으로 보여 주고, 누르면 그 자리까지 화살표 + Enter 를 넣는다(2026-10-01 사용자 "cli 안 거치게").
// 읽기는 domain/screenDialog. "Type something" 같은 직접 쓰기 칸은 글을 받아 넣는다
import { useEffect, useState } from 'react';
import { tr } from '../../i18n';
import { stepToward, type ScreenDialog } from '../../domain/screenDialog';
import { claudeDefaults } from '../../data/tauri';

const FREE = /^(type something|other|직접 입력)/i;
const DOWN = '\x1b[B';
const UP = '\x1b[A';
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function ChatDialog({ d, keys, read, onTerminal }: { d: ScreenDialog; keys: (seq: string[]) => Promise<void>; /** 지금 화면의 창(다시 읽기) */ read: () => ScreenDialog | null; onTerminal: () => void }) {
  const [sent, setSent] = useState(false);
  const [free, setFree] = useState<number | null>(null);
  const [text, setText] = useState('');
  const sig = JSON.stringify([d.question, d.options.map((o) => o.label), d.tabs]);
  useEffect(() => { setSent(false); setFree(null); setText(''); }, [sig]);
  const press = async (seq: string[]) => { setSent(true); await keys(seq); window.setTimeout(() => setSent(false), 2500); };
  // 그 번호까지 한 칸씩 — 누를 때마다 화면을 다시 읽는다. 한꺼번에 보내면 화살표가 몇 개 씹혀 엉뚱한 줄이 골라졌다(2026-10-01 시험: 하이쿠 → 페이블)
  const goTo = async (n: number): Promise<ScreenDialog | null> => {
    for (let i = 0; i < 40; i++) {
      const cur = read();
      if (!cur) return null;
      const st = stepToward(cur, n);
      if (st === 'here') return cur;
      await keys([st === 'down' ? DOWN : UP]);
      await wait(160);
    }
    return null;
  };
  /** /model 목록처럼 고르면 새 세션 기본값까지 바뀌는 창 — 모델 칩처럼 떠 뒀다 되돌린다 */
  const touchesDefaults = d.question.some((q) => /default for new sessions/i.test(q));
  const run = async (n: number, tail: string[]) => {
    setSent(true);
    const snap = touchesDefaults ? await claudeDefaults.snapshot().catch(() => null) : null;
    try {
      const at = await goTo(n);
      if (at) await keys(tail.length ? tail : [at.confirm ?? '\r']);
    } finally {
      if (snap) { await wait(800); await claudeDefaults.restore(snap).catch(() => false); window.setTimeout(() => void claudeDefaults.restore(snap).catch(() => false), 2000); }
      window.setTimeout(() => setSent(false), 2000);
    }
  };
  const choose = (i: number) => {
    if (FREE.test(d.options[i]!.label)) { setFree(i); return; }
    void run(d.options[i]!.n, []);
  };
  const sendFree = () => {
    if (free === null || !text.trim()) return;
    void run(d.options[free]!.n, [text.trim(), '\r']);
  };
  return (
    <div className="chat-dialog" role="group" aria-label={tr('선택 창', 'Choice prompt')}>
      {d.tabs && <div className="cd-tabs">{d.tabs}</div>}
      {d.question.length > 0 && <div className="cd-q">{d.question.join(' ')}</div>}
      <div className="cd-opts">
        {d.options.map((o, i) => (
          <button key={`${o.n}-${o.label}`} className={`cd-opt ${i === d.cursor ? 'cur' : ''}`} disabled={sent} onClick={() => choose(i)}>
            <span className="cd-label">{o.label}</span>
            {o.detail && <span className="cd-detail">{o.detail}</span>}
          </button>
        ))}
      </div>
      {free !== null && (
        <div className="cd-free">
          <input autoFocus value={text} placeholder={tr('직접 쓰기 — Enter 로 보내기', 'Type your answer — Enter to send')}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); sendFree(); } if (e.key === 'Escape') setFree(null); e.stopPropagation(); }} />
        </div>
      )}
      <div className="cd-foot">
        {d.partial && <span>{tr('목록 일부만 보여요', 'Only part of the list is shown')}</span>}
        <button className="chat-more" disabled={sent} onClick={() => void press(['\x1b'])}>{tr('취소', 'Cancel')}</button>
        <button className="chat-more" onClick={onTerminal}>{tr('터미널로 보기', 'Show terminal')}</button>
      </div>
    </div>
  );
}
