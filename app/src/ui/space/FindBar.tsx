import { useEffect, useRef, useState } from 'react';
import { findAll } from '../../domain/findText';
import { tr } from '../../i18n';
import { IconChevron, IconClose } from '../Icons';

type HL = { new (...r: Range[]): unknown };
const highlights = () => (globalThis as unknown as { CSS?: { highlights?: Map<string, unknown> } }).CSS?.highlights;
const Highlight = (globalThis as unknown as { Highlight?: HL }).Highlight;

/**
 * 문서 찾기(⌘F) — 찾은 곳을 모두 칠하고(편집·선택은 안 건드림) Enter 다음, Shift+Enter 앞, Esc 닫기(2026-09-30 사용자).
 * 칠하기는 CSS Custom Highlight — 글자를 감싸지 않아 편집기 문서가 안 바뀐다
 */
export function FindBar({ root, onClose }: { root: () => HTMLElement | null; onClose: () => void }) {
  const [q, setQ] = useState('');
  const [n, setN] = useState(0);
  const [i, setI] = useState(0);
  const ranges = useRef<Range[]>([]);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { input.current?.focus(); input.current?.select(); }, []);
  const paint = (idx: number) => {
    const hs = highlights();
    if (!hs || !Highlight) return;
    const all = ranges.current;
    hs.set('cv-find', new Highlight(...all));
    if (all[idx]) {
      hs.set('cv-find-cur', new Highlight(all[idx]!));
      (all[idx]!.startContainer.parentElement)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    } else hs.delete('cv-find-cur');
  };
  const run = (text: string) => {
    const el = root();
    if (!el) return;
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const nodes: Text[] = [];
    for (let t = walker.nextNode(); t; t = walker.nextNode()) nodes.push(t as Text);
    ranges.current = findAll(nodes.map((t) => t.data), text).map(([k, a, b]) => { const r = document.createRange(); r.setStart(nodes[k]!, a); r.setEnd(nodes[k]!, b); return r; });
    setN(ranges.current.length);
    setI(0);
    paint(0);
  };
  useEffect(() => () => { highlights()?.delete('cv-find'); highlights()?.delete('cv-find-cur'); }, []);
  const go = (d: 1 | -1) => { if (!n) return; const k = (i + d + n) % n; setI(k); paint(k); };
  return (
    <div className="cv-find" role="search">
      <input ref={input} value={q} placeholder={tr('문서에서 찾기', 'Find in document')}
        onChange={(e) => { setQ(e.target.value); run(e.target.value); }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); go(e.shiftKey ? -1 : 1); }
          if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); }
        }} />
      <span className="cv-find-n">{q ? (n ? `${i + 1} / ${n}` : tr('없음', 'None')) : ''}</span>
      <button onClick={() => go(-1)} aria-label={tr('앞', 'Previous')} title={tr('앞 (Shift+Enter)', 'Previous (Shift+Enter)')}><IconChevron /></button>
      <button onClick={() => go(1)} aria-label={tr('다음', 'Next')} title={tr('다음 (Enter)', 'Next (Enter)')}><IconChevron /></button>
      <button onClick={onClose} aria-label={tr('닫기', 'Close')} title={tr('닫기 (Esc)', 'Close (Esc)')}><IconClose /></button>
    </div>
  );
}
