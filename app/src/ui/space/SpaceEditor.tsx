import '@blocknote/mantine/style.css';
import { useEffect, useRef, useState } from 'react';
import { getDefaultReactSlashMenuItems, SuggestionMenuController, useCreateBlockNote } from '@blocknote/react';
import { filterSuggestionItems } from '@blocknote/core/extensions';
import { BlockNoteView } from '@blocknote/mantine';
import { ko } from '@blocknote/core/locales';
import { invoke } from '@tauri-apps/api/core';
import { BlockNoteSchema, defaultBlockSpecs, type BlockNoteEditor } from '@blocknote/core';
import { DocDirContext, PageBlock, toPageBlocks } from './PageBlock';

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
import { docUrl, pathOfDocUrl } from '../../domain/reader';
import { docDropBlocks, dropSlot } from '../../domain/drop';
import { DOC_DROP_EVENT, DOC_OVER_EVENT } from '../fileDrop';

const dark = () => document.documentElement.dataset.theme === 'dark' || (document.documentElement.dataset.theme !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches);

/**
 * 스페이스 편집기 — md 파일을 노션처럼 고친다(project-a 캔버스와 같은 BlockNote 0.51.4, 2026-09-30 사용자).
 * 기본 블록만 — 콜아웃 같은 직접 만든 블록은 md 로 저장하면 정보가 빠진다.
 * onReady(정리된 md) = 처음 읽었다 다시 쓴 모양 — BlockNote 는 md 모양을 조금 바꿔서(목록 기호·표), 비교 기준을 이걸로 잡아야
 * 한 줄 고쳤는데 문서 전체가 바뀐 것처럼 안 보인다. onChange(md) = 사람이 고칠 때마다(저장은 부르는 쪽이 모아서)
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
    // 상대 경로 그림은 문서 폴더 기준 hodoc:// 로 보여 준다
    resolveFileUrl: async (url: string) => (/^[a-z][a-z0-9+.-]*:/i.test(url) || url.startsWith('/') ? url : new URL(url, docUrl(dir + '/')).href),
  });
  useEffect(() => { onEditor?.(editor as unknown as BlockNoteEditor); return () => onEditor?.(null); }, [editor]); // eslint-disable-line react-hooks/exhaustive-deps
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
      const blocks = toPageBlocks(await editor.tryParseMarkdownToBlocks(md));
      if (!alive) return;
      editor.replaceBlocks(editor.document, blocks);
      onReady(await editor.blocksToMarkdownLossy(editor.document));
      ready.current = true;
    })();
    return () => { alive = false; };
    // 처음 한 번만 — 저장할 때마다 다시 읽으면 커서가 튄다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <DocDirContext.Provider value={dir}>
    <div className="space-editor" ref={box}>
      {line !== null && <div className="sp-drop-line" style={{ top: line }} />}
      <BlockNoteView
        editor={editor}
        theme={theme}
        slashMenu={false}
        onChange={() => { if (ready.current) void Promise.resolve(editor.blocksToMarkdownLossy(editor.document)).then(onChange); }}
      >
        {/* "/" 메뉴 — 기본 블록 + "페이지"(하위 페이지를 만들고 이 자리에 링크, 노션처럼 — 2026-09-30 사용자) */}
        <SuggestionMenuController triggerCharacter="/" getItems={async (query) => filterSuggestionItems([
          ...(onNewSubpage ? [{
            title: '페이지', subtext: '하위 페이지를 만들고 여기에 링크', aliases: ['page', 'subpage', '페이지', '하위', 'ㅍ'], group: '기본 블록',
            onItemClick: () => {
              void onNewSubpage().then((abs) => {
                const rel = abs.startsWith(dir + '/') ? abs.slice(dir.length + 1) : abs;
                // 하위 페이지 블록 — 지금 줄이 비었으면 그 자리, 아니면 다음 줄
                const cur = editor.getTextCursorPosition().block;
                const empty = Array.isArray(cur.content) && cur.content.length === 0;
                const block = { type: 'page' as const, props: { href: encodeURI(rel) } };
                if (empty) editor.updateBlock(cur, block); else editor.insertBlocks([block], cur, 'after');
              });
            },
          }] : []),
          ...getDefaultReactSlashMenuItems(editor),
        ], query)} />
      </BlockNoteView>
    </div>
    </DocDirContext.Provider>
  );
}
