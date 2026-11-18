// 진짜 MemoPanel·useLessons + 가짜 교훈 명령(파일 = run.mjs 가 넣는 window.__FIX). ?mode=before 는 옛 App 처럼 프로젝트로 고른다
import { createRoot } from 'react-dom/client';
import '../../src/ui/layers.css';
import '../../src/ui/styles.css';

type W = { __FIX: Record<string, string>; __calls: { cmd: string; args: Record<string, unknown> }[]; __TAURI_INTERNALS__: unknown };
const w = window as unknown as W;
const files = { ...w.__FIX };
w.__calls = [];
const invoke = async (cmd: string, args: Record<string, unknown> = {}) => {
  w.__calls.push({ cmd, args });
  if (cmd === 'read_lessons') return Object.fromEntries((args.names as string[]).map((n) => [n, files[n] ?? '']));
  if (cmd === 'write_lessons') { files[args.name as string] = args.content as string; return null; }
  if (cmd === 'unmirror_lesson') return false;
  if (cmd === 'undo_memory_rule') {
    for (const k of Object.keys(files)) files[k] = files[k].split('\n').filter((l) => !l.includes(`<!-- ${args.id} -->`)).join('\n');
    return null;
  }
  throw new Error(`모르는 명령 ${cmd}`);
};
w.__TAURI_INTERNALS__ = { invoke, transformCallback: () => 0, unregisterCallback: () => {}, convertFileSrc: (p: string) => p };

const { MemoPanel } = await import('../../src/ui/MemoPanel');
const { useLessons } = await import('../../src/ui/useLessons');
const { lessonScope } = await import('../../src/domain/lessons');
const before = new URLSearchParams(location.search).get('mode') === 'before';
const chiefs = (new URLSearchParams(location.search).get('chiefs') ?? '').split(',');

function Chief({ name }: { name: string }) {
  const s = { name, project: 'honor-orchestrator' };
  const scope = before ? s.project : lessonScope(s, true);
  const l = useLessons(scope);
  return (
    <div className="chief" data-name={name} style={{ width: 420, height: 680, position: 'relative' }}>
      <MemoPanel project={name} items={[]} onAdd={async () => {}} onSend={() => {}} onCopy={() => {}} onRemove={() => {}} onClose={() => {}}
        lessons={{ scope, mine: l.mine, common: l.common }}
        onRemoveLesson={(n, x) => void l.remove(n, x)} onPromoteLesson={(x) => void l.promote(x)} />
    </div>
  );
}
createRoot(document.getElementById('root')!).render(<>{chiefs.map((c) => <Chief key={c} name={c} />)}</>);
