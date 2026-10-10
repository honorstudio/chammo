// 참모 모드 트리 그리기 — domain/modeTree 가 고른 마디만, 앱 CSS 토큰으로(참모 화면처럼 보이게 = '네이티브').
// HTML 은 안 받는다: 글은 글로, Markdown 만 앱 md 거름(DOMPurify)
import { useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { tr } from '../../i18n';
import { actOf, hrefOk, type Act, type Kid, type TNode } from '../../domain/modeTree';
import { mdToHtml } from '../md';
import { openTarget } from '../../data/tauri';
import { ClientNode, ModeCtx } from './ModeClient';

export type Drafts = Map<string, string>;

const open = (href: string) => {
  if (!hrefOk(href)) return;
  const file = href.startsWith('file:');
  void openTarget(file ? 'file' : 'url', file ? decodeURI(href.replace(/^file:\/\//, '')) : href).catch(() => {});
};

function Kids({ kids, onAct, drafts }: { kids: Kid[]; onAct: (a: Act) => void; drafts: Drafts }) {
  return <>{kids.map((k, i) => (typeof k === 'string' ? k : <Node key={i} n={k} onAct={onAct} drafts={drafts} />))}</>;
}

function InputNode({ n, onAct, drafts }: { n: Extract<TNode, { type: 'Input' }>; onAct: (a: Act) => void; drafts: Drafts }) {
  const [v, setV] = useState(() => drafts.get(n.key) ?? n.value);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const submit = () => {
    const a = actOf(n, { value: v, submit: true });
    if (a) onAct(a);
    drafts.delete(n.key);
    setV('');
  };
  return (
    <label className="mdv-field">
      {n.label && <span className="mdv-label">{n.label}</span>}
      <input
        value={v}
        placeholder={n.placeholder}
        onChange={(e) => {
          const x = e.target.value;
          setV(x);
          drafts.set(n.key, x);
          // 칠 때마다가 아니라 잠깐 멈출 때 — 모드가 onInput 으로 걸러 보기 같은 걸 할 수 있게
          window.clearTimeout(timer.current);
          timer.current = window.setTimeout(() => { const a = actOf(n, { value: x, submit: false }); if (a) onAct(a); }, 300);
        }}
        onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); } }}
      />
      {n.submitLabel && <button className="btn" onClick={submit}>{n.submitLabel}</button>}
    </label>
  );
}

export function Node({ n, onAct, drafts }: { n: TNode; onAct: (a: Act) => void; drafts: Drafts }): ReactNode {
  switch (n.type) {
    case 'Box':
      return <div className="mdv-box" style={n.style}>{n.children.map((c, i) => <Node key={i} n={c} onAct={onAct} drafts={drafts} />)}</div>;
    case 'Text':
      return <span className="mdv-text" style={n.style}><Kids kids={n.kids} onAct={onAct} drafts={drafts} /></span>;
    case 'Button': {
      const a = actOf(n);
      const body = n.kids.length ? <Kids kids={n.kids} onAct={onAct} drafts={drafts} /> : n.label;
      return (
        <button className={n.plain ? 'mdv-plain' : `btn ${n.primary ? 'pri' : ''}`} disabled={!a} style={n.dim ? { opacity: 0.6 } : undefined} onClick={() => a && onAct(a)}>
          {body}
        </button>
      );
    }
    case 'Markdown':
      return (
        <div
          className={`mdv-md ${n.dim ? 'dim' : ''}`}
          // 거른 HTML(스크립트·on*·style·iframe·img 없음). 링크는 아래에서 가로챈다
          dangerouslySetInnerHTML={{ __html: mdToHtml(n.text) }}
          onClick={(e) => {
            const el = (e.target as HTMLElement).closest('a');
            if (!el) return;
            e.preventDefault();
            open(el.getAttribute('href') ?? '');
          }}
        />
      );
    case 'Code':
      return <pre className="mdv-code" data-lang={n.language || undefined}><code>{n.source}</code></pre>;
    case 'Link':
      return hrefOk(n.href)
        ? <a className="mdv-link" href={n.href} onClick={(e) => { e.preventDefault(); open(n.href); }}>{n.label}</a>
        : <span className="mdv-text">{n.label}</span>;
    case 'Input':
      return <InputNode key={n.key} n={n} onAct={onAct} drafts={drafts} />;
    case 'Select': {
      return (
        <label className="mdv-field">
          {n.label && <span className="mdv-label">{n.label}</span>}
          <select value={n.value} onChange={(e) => { const a = actOf(n, { value: e.target.value }); if (a) onAct(a); }}>
            {n.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </label>
      );
    }
    case 'Client':
      return <ClientSlot n={n} />;
    case 'Svg':
      // 거른 SVG 를 그림으로만 — <img> 안 SVG 는 스크립트·바깥 불러오기가 안 돈다
      return <img className="mdv-svg" src={n.src} alt={n.alt} draggable={false} />;
    case 'Cant':
      return <span className="mdv-cant" title={n.what}>{tr('못 그림', "Can't draw")} · {n.alt || n.what}</span>;
  }
}

// Client 는 모드 칸 안(ModeView 가 자리를 알려 줄 때)에서만 — 해시가 바뀌면(모드를 고쳤다) 방을 새로
function ClientSlot({ n }: { n: Extract<TNode, { type: 'Client' }> }) {
  const ctx = useContext(ModeCtx);
  if (!ctx) return <span className="mdv-cant">{tr('못 그림', "Can't draw")} · Client</span>;
  return <ClientNode key={`${n.plugin}:${n.module}:${n.key}:${ctx.hashes[n.plugin] ?? ''}`} n={n} />;
}
