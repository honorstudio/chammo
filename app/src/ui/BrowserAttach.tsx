// 이 프로젝트 브라우저 붙이기(GitHub #2) — 프로젝트 화면 머리줄·스페이스 프로젝트 대시보드의 버튼, 결정 대기함 카드.
// 붙이기는 앱(Rust)이 ~/.claude.json 의 그 프로젝트 local 칸에 — 저장소 .mcp.json 은 그대로라 공유 저장소에 diff 가 안 남는다
import { useCallback, useEffect, useRef, useState } from 'react';
import { projectBrowser, projectBrowserAttach } from '../data/tauri';
import { addNeed, attachNote, projectName, showButton, type BrowserLink, type BrowserNeed } from '../domain/browserNeed';
import { tr } from '../i18n';
import { IconClose } from './Icons';

const TIP = () => tr('이 폴더 세션이 쓸 로그인 유지 브라우저를 붙여요(사람에게 로그인을 물을 수 있게). 저장소 파일은 안 건드려요',
  "Gives this folder's sessions their own logged-in browser (so they can ask you to sign in). Repo files are not touched");

/** 머리줄 버튼 — 깔려 있고 안 붙었을 때만 보인다. running = 이 폴더에 떠 있는 세션 수 */
export function BrowserAttachButton({ dir, running, className, onDone }: { dir: string; running: number; className: string; onDone: (m: string | null) => void }) {
  const [link, setLink] = useState<BrowserLink | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    setLink(null);
    if (dir) void projectBrowser(dir).then((l) => { if (live) setLink(l); }).catch(() => {});
    return () => { live = false; };
  }, [dir]);
  if (!showButton(link)) return null;
  const go = async () => {
    setBusy(true);
    try {
      const l = await projectBrowserAttach(dir);
      setLink(l);
      onDone(attachNote(l, running));
    } catch (e: unknown) {
      onDone(tr(`브라우저 연결 실패: ${String(e)}`, `Could not connect the browser: ${String(e)}`));
    } finally {
      setBusy(false);
    }
  };
  return <button className={className} disabled={busy} title={TIP()} onClick={() => void go()}>{tr('브라우저 연결', 'Connect browser')}</button>;
}

/** 결정 대기함 카드들 — 붙으면(누가 붙였든) 내려간다. 15초마다 다시 본다 */
export function useBrowserNeeds(running: (dir: string) => number) {
  const [needs, setNeeds] = useState<BrowserNeed[]>([]);
  const [links, setLinks] = useState<Record<string, BrowserLink>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const needsRef = useRef(needs);
  needsRef.current = needs;
  const notesRef = useRef(notes);
  notesRef.current = notes;
  const check = useCallback(async () => {
    const got = await Promise.all(needsRef.current.map((n) => projectBrowser(n.dir).then((l) => [n.dir, l] as const).catch(() => null)));
    const next: Record<string, BrowserLink> = {};
    for (const g of got) if (g) next[g[0]] = g[1];
    setLinks(next);
    // 붙은 카드는 내린다 — 방금 여기서 붙인 건 안내 줄을 읽게 남긴다(× 로 닫음)
    setNeeds((l) => l.filter((n) => !next[n.dir]?.connected || notesRef.current[n.dir]));
  }, []);
  useEffect(() => {
    if (!needs.length) return;
    void check();
    const t = setInterval(() => void check(), 15_000);
    return () => clearInterval(t);
  }, [needs.length, check]);
  const add = (n: Omit<BrowserNeed, 'at'>) => setNeeds((l) => addNeed(l, { ...n, at: Date.now() }));
  const drop = (dir: string) => {
    setNeeds((l) => l.filter((n) => n.dir !== dir));
    setNotes((m) => { const r = { ...m }; delete r[dir]; return r; });
  };
  const attach = async (dir: string) => {
    try {
      const l = await projectBrowserAttach(dir);
      setLinks((m) => ({ ...m, [dir]: l }));
      setNotes((m) => ({ ...m, [dir]: attachNote(l, running(dir)) }));
    } catch (e: unknown) {
      setNotes((m) => ({ ...m, [dir]: tr(`연결 실패: ${String(e)}`, `Could not connect: ${String(e)}`) }));
    }
  };
  // 아직 상태를 모르는 카드도 보인다 — 안 깔렸으면 설치 안내, 이미 붙었으면 다음 확인에서 내려간다
  const shown = needs.filter((n) => !(links[n.dir]?.connected && !notes[n.dir]));
  const node = shown.length ? (
    <>{shown.map((n) => <BrowserNeedCard key={n.dir} need={n} link={links[n.dir] ?? null} note={notes[n.dir]} onAttach={() => attach(n.dir)} onClose={() => drop(n.dir)} />)}</>
  ) : null;
  return { add, node, count: shown.length, keys: shown.map((n) => `${n.dir}@${n.at}`).join('|') };
}

function BrowserNeedCard({ need, link, note, onAttach, onClose }: { need: BrowserNeed; link: BrowserLink | null; note?: string; onAttach: () => Promise<void>; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const installed = link?.available !== false;
  return (
    <div className="login-card browser-card" role="alert">
      <div className="login-card-top">
        <b>{tr(`${projectName(need.dir)} 에 브라우저가 안 붙어 있어요`, `${projectName(need.dir)} has no browser connected`)}</b>
        {!note && installed && (
          <button className="btn pri login-card-btn" disabled={busy || !link} title={TIP()} onClick={() => { setBusy(true); void onAttach().finally(() => setBusy(false)); }}>{tr('연결', 'Connect')}</button>
        )}
        <button className="ib" title={tr('닫기', 'Close')} aria-label={tr('닫기', 'Close')} onClick={onClose}><IconClose /></button>
      </div>
      {need.why && <div className="login-card-where">{need.why}</div>}
      {!installed && <div className="login-card-where">{tr('먼저 설정 → 기능 → 브라우저 자동화의 설치', 'First: Settings → Features → Browser automation → Install')}</div>}
      {note && <div className="login-card-where">{note}</div>}
    </div>
  );
}
