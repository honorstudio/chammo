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
const schema = BlockNoteSchema.create({ blockSpecs: { ...defaultBlockSpecs, page: PageBlock() } });
import { CanvasListBackspace } from './listBackspace';
import { docUrl } from '../../domain/reader';

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
    <div className="space-editor">
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
