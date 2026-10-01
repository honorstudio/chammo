import { invoke } from '@tauri-apps/api/core';
import { useEffect, useState } from 'react';
import { tr } from '../../i18n';
import { IconChevron, IconFile, IconFolder, IconPage } from '../Icons';
import { dragPath } from './dragPath';

type Entry = { name: string; path: string; dir: boolean };

// 펼친 폴더 기억 — 이 컴퓨터에만
const KEY = 'spaceTreeOpen';
const loadOpen = (): string[] => { try { return JSON.parse(localStorage.getItem(KEY) ?? '[]') as string[]; } catch { return []; } };
const kids = new Map<string, Entry[]>(); // 한 번 읽은 폴더(다시 펼칠 때 바로)

/**
 * 프로젝트 파일 나무 — IDE 처럼 폴더 안 폴더(2026-09-30 사용자). 누르면 md 는 노션식 문서, 그 밖(그림·영상·시안·PDF·글)은 미리보기.
 * 숨김·무거운 폴더(.git·node_modules 등)는 Rust 가 뺀다. 폴더는 펼칠 때 읽는다
 */
export function FileTree({ root, selected, onOpen }: { root: string; selected?: string; onOpen: (path: string) => void }) {
  const [open, setOpen] = useState<string[]>(loadOpen);
  const [, bump] = useState(0);
  const load = (dir: string) => void invoke<Entry[]>('list_dir', { dir }).then((l) => { kids.set(dir, l); bump((n) => n + 1); }).catch(() => {});
  useEffect(() => { load(root); for (const d of open) if (d.startsWith(`${root}/`)) load(d); }, [root]); // eslint-disable-line react-hooks/exhaustive-deps
  const toggle = (d: string) => setOpen((o) => {
    const next = o.includes(d) ? o.filter((x) => x !== d) : [...o, d];
    if (!o.includes(d)) load(d);
    try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* 이번 실행만 */ }
    return next;
  });
  const rows = (dir: string, depth: number): React.ReactNode[] => (kids.get(dir) ?? []).flatMap((e) => {
    const pad = { paddingLeft: 6 + depth * 14 };
    if (e.dir) {
      const on = open.includes(e.path);
      return [
        <div key={e.path} {...dragPath(e.path)} className="cv-row child tree" style={pad} onClick={() => toggle(e.path)} title={e.path}>
          <span className={`cv-fold small ${on ? 'open' : ''}`}><IconChevron /></span>
          <span className="cv-ic"><IconFolder /></span><span className="cv-label">{e.name}</span>
        </div>,
        ...(on ? rows(e.path, depth + 1) : []),
      ];
    }
    return [
      <div key={e.path} {...dragPath(e.path)} className={`cv-row child tree ${selected === e.path ? 'on' : ''}`} style={pad} onClick={() => onOpen(e.path)} title={e.path}>
        <span className="cv-fold small blank" />
        <span className="cv-ic">{/\.md$/i.test(e.name) ? <IconPage /> : <IconFile />}</span><span className="cv-label">{e.name}</span>
      </div>,
    ];
  });
  const list = rows(root, 0);
  return <div className="cv-tree">{kids.has(root) ? (list.length ? list : <div className="cv-empty">{tr('빈 폴더', 'Empty folder')}</div>) : <div className="cv-empty">{tr('읽는 중', 'Reading')}</div>}</div>;
}
