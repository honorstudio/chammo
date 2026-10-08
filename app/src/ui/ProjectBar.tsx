import { useState } from 'react';
import { harnessProject, newSession } from '../data/tauri';
import { tr } from '../i18n';
import { BrowserAttachButton } from './BrowserAttach';

type Props = {
  project: string;
  cwd: string;
  count: number;
  onDone: (m: string | null) => void;
  /** CLAUDE.md·starter 가 없으면 "하네스 깔기" — 빈 자리만 채운다 */
  needsHarness?: boolean;
};

/** 프로젝트 화면 머리줄: 같은 폴더에 세션 하나 더 / 새 worktree 에서 세션 */
export function ProjectBar({ project, cwd, count, onDone, needsHarness }: Props) {
  const [wt, setWt] = useState('');
  const [busy, setBusy] = useState(false);

  const spawn = async (worktree?: string) => {
    setBusy(true);
    try {
      await newSession(cwd, worktree ? `${project}/${worktree}` : project, worktree);
      setWt('');
      onDone(null);
    } catch (e: unknown) {
      onDone(tr(`새 세션 실패: ${String(e)}`, `New session failed: ${String(e)}`));
    } finally {
      setBusy(false);
    }
  };

  const harness = async () => {
    setBusy(true);
    try {
      const r = await harnessProject(cwd);
      onDone(r.written.length ? null : tr('이미 다 있어요', 'Everything is already there'));
    } catch (e: unknown) {
      onDone(tr(`하네스 깔기 실패: ${String(e)}`, `Could not set up the harness: ${String(e)}`));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bar">
      <b>{project}</b>
      <span className="dim">{tr('창', 'Panes')} {count}</span>
      <span className="sp" />
      <BrowserAttachButton dir={cwd} running={count} className="btn" onDone={onDone} />
      {needsHarness && (
        <button className="btn pri" disabled={busy} onClick={() => void harness()} title={tr('CLAUDE.md·docs/starter.md·docs/roadmap.md 를 깐다 — 있는 파일은 안 덮는다', 'Adds CLAUDE.md, docs/starter.md, docs/roadmap.md — never overwrites existing files')}>
          {tr('하네스 깔기', 'Set up harness')}
        </button>
      )}
      <button className="btn" disabled={busy} onClick={() => void spawn()}>
        {tr('같은 폴더에 새 세션', 'New session in same folder')}
      </button>
      <input
        className="inp"
        placeholder={tr('worktree 이름', 'Worktree name')}
        value={wt}
        onChange={(e) => setWt(e.target.value.replace(/[^a-zA-Z0-9._-]/g, '-'))}
      />
      <button className="btn" disabled={busy || !wt.trim()} onClick={() => void spawn(wt.trim())}>
        {tr('worktree로 새 세션', 'New session in worktree')}
      </button>
    </div>
  );
}
