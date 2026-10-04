import '@blocknote/mantine/style.css';
import { useEffect, useRef, useState } from 'react';
import { getDefaultReactSlashMenuItems, SuggestionMenuController, useCreateBlockNote } from '@blocknote/react';
import { filterSuggestionItems } from '@blocknote/core/extensions';
import { BlockNoteView } from '@blocknote/mantine';
import { ko } from '@blocknote/core/locales';
import { invoke } from '@tauri-apps/api/core';
import { BlockNoteSchema, defaultBlockSpecs, type BlockNoteEditor } from '@blocknote/core';
import { DocDirContext, PageBlock } from './PageBlock';
import './editorTone.css';
import { installBlockDrag } from './blockDrag';
import { duplicateBlock, notionSlashItems } from '../../domain/docBlocks';

// 기본 블록 + 하위 페이지 블록(노션처럼)
// 편집기의 다운로드 버튼은 window.open(앱 파일 주소)인데 앱 창 안에선 아무 일도 안 일어났다 — 그 주소면 기본 앱으로 연다(2026-10-01 사용자)
if (typeof window !== 'undefined' && !(window as { __docOpen?: boolean }).__docOpen) {
  (window as { __docOpen?: boolean }).__docOpen = true;
  const nativeOpen = window.open.bind(window);
  window.open = (url?: string | URL, ...rest: [string?, string?]) => {
    const p = url ? pathOfDocUrl(String(url)) : null;
    if (p) { void invoke('open_target', { kind: 'file', target: p }).catch(() => {}); return null; }
    return nativeOpen(url, ...rest);
  };
}

const schema = BlockNoteSchema.create({ blockSpecs: { ...defaultBlockSpecs, page: PageBlock() } });
import { CanvasListBackspace } from './listBackspace';
import { copyText } from './copyText';
import { selectAllStep, wholeText } from './selectAllStep';
import { docSelectAll } from '../selectAll';
import { docFileUrl, IS_WIN, pathOfDocUrl } from '../../domain/reader';
import { docDropBlocks, dropSlot } from '../../domain/drop';
import { DOC_DROP_EVENT, DOC_OVER_EVENT } from '../fileDrop';
import { useDocSync } from './docSync';
import { parseMd } from './mdPipeline';
import { saveSoon } from './docSave';
import { tr } from '../../i18n';

const dark = () => document.documentElement.dataset.theme === 'dark' || (document.documentElement.dataset.theme !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches);

/**
 * 스페이스 편집기 — md 파일을 노션처럼 고친다(project-a 캔버스와 같은 BlockNote 0.51.4, 2026-09-30 사용자).
 * 기본 블록만 — 콜아웃 같은 직접 만든 블록은 md 로 저장하면 정보가 빠진다.
 * onReady(정리된 md) = 처음 읽었다 다시 쓴 모양 — BlockNote 는 md 모양을 조금 바꿔서(목록 기호·표), 비교 기준을 이걸로 잡아야
 * 한 줄 고쳤는데 문서 전체가 바뀐 것처럼 안 보인다. onChange(md) = 바뀔 때마다(제목 따라가기 등). 저장은 여기서(docSave·docSync — 밖에서 고친 걸 덮지 않게)
 */
export default function SpaceEditor({ md, docPath, onReady, onChange, onEditor, onNewSubpage }: { md: string; docPath: string; onReady: (normalized: string) => void; onChange: (md: string) => void; onEditor?: (ed: BlockNoteEditor | null) => void;
  /** "/페이지" — 하위 페이지를 만들고 그 파일 경로를 돌려준다(없으면 메뉴에 안 나옴) */
  onNewSubpage?: () => Promise<string> }) {
  const dir = docPath.replace(/\/[^/]*$/, '');
  const editor = useCreateBlockNote({
    schema,
    dictionary: ko,
    extensions: [CanvasListBackspace],
    // 그림 넣기·바꾸기 — 문서 옆 assets/ 에 저장하고 md 엔 상대 경로(참모·세션이 파일로 바로 읽는다)
    uploadFile: async (file: File) => invoke<string>('save_asset', { docPath, name: file.name || 'image.png', bytes: Array.from(new Uint8Array(await file.arrayBuffer())) }),
    // 상대 경로는 문서 폴더 기준, 절대 경로도 앱 파일 주소로(그대로 두면 그림이 깨졌다)
    resolveFileUrl: async (url: string) => docFileUrl(url, dir),
    // 놓일 자리 표시 — 기본 연파랑(#ddeeff) 대신 앱 톤(2026-10-04 사용자 "파랑 위주")
    dropCursor: { color: 'rgba(128, 128, 128, .45)', width: 3 },
  });
  useEffect(() => { onEditor?.(editor as unknown as BlockNoteEditor); return () => onEditor?.(null); }, [editor]); // eslint-disable-line react-hooks/exhaustive-deps
  const sync = useDocSync(editor as unknown as BlockNoteEditor, docPath, md);
  // 파인더에서 끌어다 놓은 파일 — 문서 옆 assets/ 로 복사해 가장 가까운 블록 위/아래에(그림·영상·소리, 나머지는 파일).
  // 지나가는 동안 들어갈 자리를 가로줄로 보여 준다(2026-10-01 사용자 — 정확히 블록 위에 놓아야만 들어가서 불편)
  const box = useRef<HTMLDivElement>(null);
  const [line, setLine] = useState<number | null>(null);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const slotAt = (y: number) => dropSlot([...el.querySelectorAll<HTMLElement>('.bn-block-outer[data-id]')].map((b) => {
      const r = b.getBoundingClientRect();
      return { id: b.dataset.id!, top: r.top, bottom: r.bottom };
    }), y);
    const over = (ev: Event) => {
      const d = (ev as CustomEvent<{ x: number; y: number } | null>).detail;
      const slot = d ? slotAt(d.y) : null;
      setLine(slot ? slot.y - el.getBoundingClientRect().top : null);
    };
    const on = (ev: Event) => {
      const { paths, y } = (ev as CustomEvent<{ paths: string[]; x: number; y: number }>).detail;
      setLine(null);
      const items = docDropBlocks(paths);
      if (!items.length) return;
      const slot = slotAt(y);
      const at = (slot && editor.getBlock(slot.id)) || editor.getTextCursorPosition().block;
      const place = slot?.place ?? 'after';
      void Promise.all(items.map((it) => invoke<string>('copy_asset', { docPath, src: it.path }))).then((urls) => {
        const name = (p: string) => p.split(/[\\/]/).pop() ?? p;
        editor.insertBlocks(items.map((it, i) => (it.type === 'file'
          ? { type: 'file' as const, props: { url: urls[i]!, name: name(it.path) } }
          : { type: it.type, props: { url: urls[i]! } })), at, place);
      }).catch(() => {});
    };
    el.addEventListener(DOC_OVER_EVENT, over);
    el.addEventListener(DOC_DROP_EVENT, on);
    return () => { el.removeEventListener(DOC_DROP_EVENT, on); el.removeEventListener(DOC_OVER_EVENT, over); };
  }, [editor, docPath]);
  // 블록 손잡이 끌기(마우스 따라가기 — 웹 끌기는 앱 창이 가져간다, blockDrag.ts) + ⌘D 블록 복제(노션)
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const off = installBlockDrag(el, editor as unknown as BlockNoteEditor, setLine);
    const key = (e: KeyboardEvent) => {
      if (e.code !== 'KeyD' || e.shiftKey || e.altKey || !(IS_WIN ? e.ctrlKey && !e.metaKey : e.metaKey && !e.ctrlKey)) return;
      e.preventDefault(); e.stopPropagation();
      const picked = editor.getSelection()?.blocks ?? [editor.getTextCursorPosition().block];
      const last = picked[picked.length - 1];
      if (!last) return;
      const made = editor.insertBlocks(picked.map((b) => duplicateBlock(b) as typeof b), last, 'after');
      const first = made[0];
      if (first) try { editor.setTextCursorPosition(first, 'end'); } catch { /* 글 칸 없는 블록(그림·페이지) */ }
    };
    el.addEventListener('keydown', key, true);
    return () => { off(); el.removeEventListener('keydown', key, true); };
  }, [editor]);
  // 복사·잘라내기 — BlockNote 가 text/plain 에 마크다운(| --- |·백틱)을 넣는다. 그 뒤(거품 단계)에 사람 글로만 갈아 끼운다.
  // 글은 먼저(포착 단계) 읽어 둔다 — 잘라내기는 BlockNote 가 지운 뒤라 선택이 비어 있다. text/html 은 그대로(서식 붙여넣기용).
  // ⌘A — 앱 단축키(selectAll.ts)가 부르면 칸(표 셀·블록) → 문서 전체로 한 단계씩(노션처럼)
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    let text: string | null = null;
    const read = () => {
      // 빈 글(그림 블록만 고름 등)이면 BlockNote 것을 그대로 둔다. 바꾸다 실패해도 복사 자체는 산다
      try { const s = editor.prosemirrorState.selection; text = s.empty ? null : copyText(s) || null; } catch { text = null; }
    };
    const write = (ev: ClipboardEvent) => {
      // BlockNote 가 안 받은 복사(선택 없음·편집 안 되는 칸)는 브라우저 기본 그대로
      if (ev.defaultPrevented && ev.clipboardData && text !== null) ev.clipboardData.setData('text/plain', text);
      text = null;
    };
    el.addEventListener('copy', read, true);
    el.addEventListener('cut', read, true);
    el.addEventListener('copy', write);
    el.addEventListener('cut', write);
    docSelectAll.set(el, () => {
      const { doc, selection } = editor.prosemirrorState;
      const r = selectAllStep(doc, selection.from, selection.to);
      const range = r === 'all' ? wholeText(doc) : r;
      // 선택 클래스(TextSelection)를 따로 들이지 않으려고 BlockNote 안 tiptap 명령을 쓴다
      if (range) editor._tiptapEditor.commands.setTextSelection(range);
      else editor._tiptapEditor.commands.selectAll();
    });
    return () => {
      el.removeEventListener('copy', read, true);
      el.removeEventListener('cut', read, true);
      el.removeEventListener('copy', write);
      el.removeEventListener('cut', write);
      docSelectAll.delete(el);
    };
  }, [editor]);
  const ready = useRef(false);
  const [theme, setTheme] = useState<'light' | 'dark'>(dark() ? 'dark' : 'light');
  useEffect(() => {
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const on = () => setTheme(dark() ? 'dark' : 'light');
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  useEffect(() => {
    let alive = true;
    void (async () => {
      const blocks = await parseMd(editor as unknown as BlockNoteEditor, md);
      if (!alive) return;
      editor.replaceBlocks(editor.document, blocks);
      onReady(await sync.normalize());
      ready.current = true;
      sync.start(); // 밖(참모·세션)이 고치면 받는다
    })();
    return () => { alive = false; };
    // 처음 한 번만 — 저장할 때마다 다시 읽으면 커서가 튄다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <DocDirContext.Provider value={dir}>
    <div className="space-editor" ref={box}>
      {sync.state === 'conflict' && (
        <div className="cv-doc-sync" role="alert">
          <span>{tr('밖에서도 이 문서를 고쳤어요 — 같은 곳을 둘 다 고쳐서 저장을 멈췄어요. 고르지 않은 판은 기록(history)에 남아요.', 'This document was also changed outside — both sides edited the same part, so saving is paused. The version you do not pick is kept in history.')}</span>
          <button onClick={() => void sync.takeTheirs()}>{tr('바깥 판 불러오기', 'Load the outside version')}</button>
          <button className="solid" onClick={() => void sync.keepMine()}>{tr('내 판으로 저장', 'Save my version')}</button>
        </div>
      )}
      {sync.state === 'gone' && (
        <div className="cv-doc-sync" role="alert">
          <span>{tr('이 파일이 지워졌거나 이름이 바뀌었어요 — 여기서 고친 건 저장되지 않아요(마지막 판은 기록에 남겨요).', 'This file was deleted or renamed — edits here are not saved (the last version is kept in history).')}</span>
        </div>
      )}
      {line !== null && <div className="sp-drop-line" style={{ top: line }} />}
      <BlockNoteView
        editor={editor}
        theme={theme}
        slashMenu={false}
        onChange={() => {
          if (!ready.current) return;
          sync.edits.current++;
          // 바깥 판을 받아 편집기가 스스로 바꾼 것은 사람이 친 게 아니다 — 저장·보낼 것엔 안 넣고 제목만 따라간다
          const mine = !sync.quiet.current;
          void sync.normalize().then((out) => { if (mine) saveSoon(sync.session, out); onChange(out); });
        }}
      >
        {/* "/" 메뉴 — 기본 블록(한글 이름 더함) + "페이지"(하위 페이지를 만들고 이 자리에 링크, 노션처럼 — 2026-09-30 사용자) */}
        <SuggestionMenuController triggerCharacter="/" getItems={async (query) => filterSuggestionItems(notionSlashItems(getDefaultReactSlashMenuItems(editor), onNewSubpage ? {
          key: 'page', title: '페이지', subtext: '하위 페이지를 만들고 여기에 링크', aliases: ['page', 'subpage', '페이지', '하위', 'ㅍ'], group: '기본 블록',
          onItemClick: () => {
            void onNewSubpage().then((abs) => {
              const rel = abs.startsWith(dir + '/') ? abs.slice(dir.length + 1) : abs;
              // 하위 페이지 블록 — 지금 줄이 비었으면 그 자리, 아니면 다음 줄
              const cur = editor.getTextCursorPosition().block;
              const empty = Array.isArray(cur.content) && cur.content.length === 0;
              const block = { type: 'page' as const, props: { href: encodeURI(rel) } };
              const page = empty ? editor.updateBlock(cur, block) : editor.insertBlocks([block], cur, 'after')[0]!;
              // 커서는 블록 아래 빈 줄로 — 그대로 두면 친 글자가 아래 문단 앞에 붙었다(2026-10-04 시험)
              const next = editor.getNextBlock(page);
              const blank = next && next.type === 'paragraph' && Array.isArray(next.content) && next.content.length === 0
                ? next : editor.insertBlocks([{ type: 'paragraph' }], page, 'after')[0]!;
              editor.setTextCursorPosition(blank, 'start');
            });
          },
        } : undefined), query)} />
      </BlockNoteView>
    </div>
    </DocDirContext.Provider>
  );
}
