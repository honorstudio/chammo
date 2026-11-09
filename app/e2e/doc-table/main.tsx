// 문서 표 E2E 받침 — 진짜 DocPage·SpaceEditor(복사 가로채기·tableSelect)에 가짜 invoke 만. 선택·블록·글자 자리를 window 에 열어 run.mjs 가 본다
import '../../src/ui/layers.css';
import '../../src/ui/styles.css';
import '../../src/ui/space/space.css';
import { createRoot } from 'react-dom/client';
import { DocPage } from '../../src/ui/space/DocPage';

const W = window as unknown as Record<string, unknown> & { __docs: Record<string, string> };
W.__docs = {
  '/E/doc.md': '# 표 문서\n\n위 문단 글\n\n| 이름 | 값 | 메모 |\n| --- | --- | --- |\n| 사과 | 3 | 빨강 과일 |\n| 바나나 | 5 | 노랑 |\n\n아래 문단 글\n',
  // 편집기 E2E(editor.mjs) — 목록·접는 블록(<details>, 안에 접는 제목)
  '/E/misc.md': '# 여러 블록\n\n첫 문단\n\n- 하나\n- 둘\n- 셋\n\n<details>\n<summary>밖 토글</summary>\n\n속 글\n\n<details>\n<summary><h3>안 머리</h3></summary>\n\n깊은 글\n\n</details>\n\n</details>\n\n마지막 문단\n',
};
const q = new URLSearchParams(location.search);
if (q.get('md') != null) W.__docs['/E/q.md'] = q.get('md')!; // 저장한 글을 다시 열어 보기(editor.mjs)
const PATH = q.get('p') ?? '/E/doc.md';
W.__TAURI_INTERNALS__ = {
  invoke: async (cmd: string, a: { path: string; text: string }) => {
    if (cmd === 'read_doc_text') return W.__docs[a.path] ?? '';
    if (cmd === 'write_doc_text') { W.__docs[a.path] = a.text; return `s${Date.now()}`; }
    if (cmd === 'doc_stamp') return 's1';
    return null;
  },
  transformCallback: () => 0, metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } },
};
type Tip = { state: { selection: { constructor: { name: string }; from: number; to: number } } };
const tip = () => (document.querySelector('.ProseMirror') as unknown as { editor: Tip }).editor;
Object.assign(W, {
  __md: () => W.__docs[PATH],
  __tip: tip,
  // 블록 나무 — [종류(+T 접는 제목), 글, 안쪽]
  __tree: () => {
    type J = { type: string; attrs?: { isToggleable?: boolean }; text?: string; content?: J[] };
    const walk = (n: J): unknown[] => (n.content ?? []).map((c) => { const b = c.content![0]!; return [b.type + (b.attrs?.isToggleable ? '+T' : ''), (b.content ?? []).map((x) => x.text).join(''), c.content![1] ? walk(c.content![1]) : []]; });
    return walk(((tip() as unknown as { state: { doc: { toJSON(): J } } }).state.doc.toJSON().content![0])!);
  },
  // 파랗게 고른 블록 글
  __picked: () => [...document.querySelectorAll('.bn-block-outer > .bn-block')].filter((b) => getComputedStyle(b).backgroundColor !== 'rgba(0, 0, 0, 0)').map((b) => b.querySelector('.bn-block-content')?.textContent),
  __blocks: () => [...document.querySelectorAll<HTMLElement>('.bn-block-content')].map((b) => `${b.dataset.contentType}:${b.textContent}`),
  __sel: () => { const s = tip().state.selection; return { type: s.constructor.name, from: s.from, to: s.to, text: String(getSelection()) }; },
  __cell: (r: number, c: number) => document.querySelectorAll('.bn-block-content[data-content-type=table] tr')[r]?.querySelectorAll('th,td')[c],
  __para: (t: string) => [...document.querySelectorAll('.bn-block-content')].find((b) => b.textContent === t),
  // el 안 n 번째 글자 왼쪽(끝이면 마지막 글자 오른쪽) 화면 좌표
  __charXY: (el: Element, n: number) => {
    const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let k = n;
    for (let t = w.nextNode() as Text | null; t; t = w.nextNode() as Text | null) {
      if (k <= t.length) {
        const r = document.createRange();
        if (k < t.length) { r.setStart(t, k); r.setEnd(t, k + 1); const b = r.getBoundingClientRect(); return [b.left + 1, b.top + b.height / 2]; }
        r.setStart(t, k - 1); r.setEnd(t, k); const b = r.getBoundingClientRect(); return [b.right - 1, b.top + b.height / 2];
      }
      k -= t.length;
    }
    return null;
  },
});
createRoot(document.getElementById('root')!).render(
  <div className="cv" style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}><DocPage personal path={PATH} owner="e2e" /></div>,
);
