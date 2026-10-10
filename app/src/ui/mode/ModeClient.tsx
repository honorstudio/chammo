// 참모 모드 Client 칸 — 모드의 화면 모듈은 안 보이는 방(iframe, 별도 주소 modeframe:// + CSP sandbox)에서만 돈다.
// 방은 트리를 글로 보내고 여기서 앱 렌더러(Node)가 거른 뒤 그린다. 누름은 규약(ui_client_press)에 묻고 답(reached)을 방에 돌려준다
import { invoke } from '@tauri-apps/api/core';
import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { tr } from '../../i18n';
import { cellsOf, type Act, type TNode } from '../../domain/modeTree';
import { clientTree, frameMsg, frameUrl, PostGate } from '../../domain/modeClient';
import { Node, type Drafts } from './ModeTree';

/** 지금 그리는 칸 — Client 자리(instance_id·component)와 그 그림의 모듈 해시(ui_render client_modules) */
export type ModeCtxValue = { name: string; component: string; instance: string; hashes: Record<string, string> };
export const ModeCtx = createContext<ModeCtxValue | null>(null);

type Bundle = { runtime: string; limits: unknown; files: { key: string; source: string }[]; modules: { module: string; entry: string; component: string }[] };
type Reply = { handled?: boolean; reached?: unknown; props?: unknown };

export function ClientNode({ n }: { n: Extract<TNode, { type: 'Client' }> }) {
  const ctx = useContext(ModeCtx);
  const frame = useRef<HTMLIFrameElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const [tree, setTree] = useState<TNode | null>(null);
  const [fault, setFault] = useState<string | null>(null);
  const drafts = useRef<Drafts>(new Map()).current;
  const gate = useRef(new PostGate()).current;
  const loaded = useRef(false);
  const cells = useRef({ columns: 40, rows: 8 });
  const props = useRef(n.props);
  props.current = n.props;
  const name = ctx?.name ?? '';
  const at = { plugin: n.plugin, instance_id: ctx?.instance ?? '', client: n.key, module: n.module, component: ctx?.component ?? '' };
  const atRef = useRef(at);
  atRef.current = at;
  const post = (m: unknown) => frame.current?.contentWindow?.postMessage(m, '*');

  useEffect(() => {
    const on = (e: MessageEvent) => {
      if (!frame.current || e.source !== frame.current.contentWindow) return; // 이 방이 보낸 것만
      const m = frameMsg(e.data);
      if (!m) return;
      if (m.mf === 'ready') {
        if (loaded.current) return;
        void invoke<Bundle>('mode_client_module', { name, plugin: n.plugin }).then((b) => {
          const entry = b?.modules?.find((x) => x.module === n.module);
          if (!entry) { setFault(tr('모드가 이 칸 모듈을 안 줬어', 'The mode did not serve this module')); return; }
          loaded.current = true;
          post({ mf: 'load', files: b.files, runtime: b.runtime, limits: b.limits, entry: entry.entry, export: entry.component, props: props.current, ...cells.current });
        }, (err) => setFault(String(err).slice(0, 200)));
      } else if (m.mf === 'tree') {
        setTree(clientTree(m.text));
        setFault(null);
      } else if (m.mf === 'post') {
        if (!gate.take()) return;
        void invoke<Reply>('mode_client_message', { name, at: atRef.current, data: m.data }).then((r) => { if (r && 'props' in r && r.props !== undefined) post({ mf: 'props', props: r.props }); }, () => {});
      } else if (m.mf === 'fault') {
        setFault(m.reason || tr('모듈이 멈췄어', 'The module stopped'));
        void invoke('mode_client_fault', { name, at: atRef.current, phase: m.phase, reason: m.reason }).catch(() => {});
      }
    };
    window.addEventListener('message', on);
    return () => window.removeEventListener('message', on);
  }, [name, n.plugin, n.module]); // eslint-disable-line react-hooks/exhaustive-deps

  // 모드가 props 를 바꿔 다시 그렸으면 방에도(방 안 상태는 그대로)
  const propsKey = JSON.stringify(n.props ?? null);
  useEffect(() => { if (loaded.current) post({ mf: 'props', props: n.props }); }, [propsKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // 칸 크기 → 글자 칸(surface.columns·rows)
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([x]) => {
      if (!x) return;
      const c = cellsOf(x.contentRect.width, Math.max(x.contentRect.height, 18));
      if (c.columns === cells.current.columns && c.rows === cells.current.rows) return;
      cells.current = c;
      if (loaded.current) post({ mf: 'resize', ...c });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const onAct = (a: Act) => {
    if (!a.held || !a.key) return;
    const act = { kind: a.kind, element: a.key, ...('value' in a ? { value: a.value } : {}), ...('submit' in a ? { submit: a.submit } : {}) };
    void invoke<Reply>('mode_client_act', { name, at: atRef.current, act }).then((r) => {
      // 모드 훅이 누름을 막았으면(reached 없음) 닫힌 함수는 안 돈다
      if (r?.handled && r.reached !== undefined) post({ mf: 'held', handle: a.handle, event: r.reached });
    }, (err) => setFault(String(err).slice(0, 200)));
  };

  return (
    <div className="mdv-client" ref={box} style={n.style}>
      <iframe ref={frame} className="mdv-client-frame" src={frameUrl()} sandbox="allow-scripts" title={n.key} aria-hidden="true" tabIndex={-1} />
      {fault ? <span className="mdv-cant" title={fault}>{tr('못 그림', "Can't draw")} · {fault}</span>
        : tree ? <Node n={tree} onAct={onAct} drafts={drafts} />
        : <span className="mdv-note quiet"><span className="spin" /></span>}
    </div>
  );
}
