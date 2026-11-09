// 내 메모 연결 — 소스 검사(화면 동작은 e2e/my-notes). 참모에게 가는 길은 ⋯ '보여 주기' 하나뿐이어야 한다
import { describe, expect, it } from 'vitest';
import { barItems } from '../../domain/topbarMenu';
import { shortcutFor } from '../../domain/shortcuts';
import doc from '../space/DocPage.tsx?raw';
import editor from '../space/SpaceEditor.tsx?raw';
import sync from '../space/docSync.ts?raw';
import panel from './NotesPanel.tsx?raw';
import card from './NoteCard.tsx?raw';
import place from './useNotesPlace.ts?raw';
import space from '../space/SpaceView.tsx?raw';
import top from '../TopBar.tsx?raw';
import mainRs from '../../../src-tauri/src/main.rs?raw';
import notesRs from '../../../src-tauri/src/notes_window.rs?raw';
import win from './NotesWin.tsx?raw';
import phone from '../mobile/MemoTab.tsx?raw';
import css from './notes.css?raw';

describe('문서 페이지 재사용 — 보내기 단추·보낼 것을 뺀다', () => {
  it('personal 이면 SendFab·머리줄·보낼 것 기준을 안 그린다', () => {
    expect(doc).toMatch(/!personal && send && <SendFab/);
    expect(doc).toMatch(/!personal && <div className="cv-doc-bar">/);
    expect(doc).toMatch(/if \(!personal\) setBaseline\(/);
  });
  it('personal 이 편집기·저장까지 내려간다', () => {
    expect(doc).toMatch(/<SpaceEditor [^>]*personal=\{personal\}/);
    expect(editor).toMatch(/useDocSync\(editor as unknown as BlockNoteEditor, docPath, md, personal\)/);
    expect(sync).toMatch(/newSession\(path, md, personal\)/);
    expect(sync.match(/absorbOutside\(/g)?.length).toBe(sync.match(/if \(!personal\) absorbOutside\(/g)?.length);
  });
  it('메모 카드는 문서를 personal 로 연다(패널·따로 창 같은 카드)', () => {
    expect(card).toMatch(/<DocPage [^>]*personal/);
    expect(win).toMatch(/<NoteCard /);
    expect(panel).toMatch(/<NoteCard /);
  });
});

describe('참모에게 저절로 안 간다', () => {
  it('패널·카드는 참모 입력칸·채팅 길을 직접 안 부른다 — onShare·onPaste 로만', () => {
    for (const src of [panel, card]) for (const bad of ['askRef', 'attachToChat', 'chat-pending', 'sendTextToSession', 'space_log_append', 'scripts/']) expect(src).not.toContain(bad);
    expect(card.match(/onShare\(/g)?.length).toBe(1);
    expect(card.match(/onPaste\(/g)?.length).toBe(1);
  });
  it('보내기 아이콘(글 통째)은 카드 머리 단추를 누를 때만 — 패널·창·폰 같은 아이콘', () => {
    expect(card).toMatch(/const paste = async \(\) => \{[^]*?onPaste\(/);
    expect(card).toMatch(/onClick=\{\(\) => void paste\(\)\}><IconChatSend \/>/);
    expect(card).not.toMatch(/useEffect\(\(\) => \{[^}]*paste\(\)/);
    expect(win).toMatch(/onPaste=\{paste\}/);
    expect(phone).toMatch(/onClick=\{paste\}[^>]*><IconChatSend \/>/);
    expect(phone.match(/onPaste\(/g)?.length).toBe(1);
  });
  it('onShare 는 ⋯ 메뉴를 누를 때만 부른다', () => {
    expect(card).toMatch(/const share = \(\) => \{[^}]*onShare\(row\.path\)/);
    expect(card).toMatch(/onClick=\{\(\) => menu\(share\)\}/);
    expect(card).not.toMatch(/useEffect\(\(\) => \{[^}]*share\(\)/);
  });
});

describe('스킨·여러 장(시안 v2)', () => {
  it('카드 바탕이 그 메모 스킨 — ⋯ 견본으로 고르면 메타에 저장', () => {
    expect(card).toMatch(/className=\{`nt-card nt-sk sk-\$\{row\.skin\}/);
    expect(card).toMatch(/<SkinPick value=\{row\.skin\} onPick=/);
    expect(card).toMatch(/notesMeta\(row\.name, \{ skin/);
  });
  it('패널은 띄운 메모(따로 창 아닌 것)를 쌓고, 목록은 띄운 / 안 띄운 두 칸', () => {
    expect(panel).toMatch(/splitNotes\(rows\)/);
    expect(panel).toMatch(/split\.stack\.map\(\(r\) => <NoteCard /);
    expect(panel).toMatch(/tr\('띄운 메모', /);
    expect(panel).toMatch(/tr\('안 띄운 메모', /);
  });
  it('앱을 켜면 따로 창에 띄워 둔 메모가 제자리에 다시 뜬다(스티커 메모처럼)', () => {
    expect(place).toMatch(/notesList\(\)\.then\(\(rs\) => \{[^]*?r\.shown && r\.win[^]*?notesWindowOpen\(r\.name\)/);
  });
  it('창 머리 신호등 자리는 맥에서만 비운다', () => {
    expect(win).toMatch(/nt-mac/);
    expect(css).toMatch(/\.nt-mac \.nt-card\.nt-full \.nt-ch \{ padding-left: 78px/);
  });
  it('내리기·띄우기는 메타로만(파일은 안 지운다)', () => {
    expect(card).toMatch(/notesMeta\(row\.name, \{ shown: false/);
    expect(panel).toMatch(/notesMeta\(r\.name, \{ shown: true, win: false \}\)/);
    expect(css).not.toMatch(/border-left:\s*\d/);
  });
});

describe('따로 창 머리를 끌면 창이 옮겨진다', () => {
  it('맥 웹뷰(WKWebView)는 app-region 을 무시한다 — CSS 로 끌리는 척하지 않는다', () => {
    expect(css).not.toMatch(/app-region/);
  });
  it('머리를 왼쪽 단추로 처음 누르면 끌기를 시작한다 — 단추 위·패널 카드는 빼고, 글 커서는 안 뺏는다', () => {
    expect(card).toMatch(/<header className="nt-ch" onMouseDown=\{full \? downHead : undefined\} onMouseUp=\{full \? upHead : undefined\}>/);
    expect(card).toMatch(/const downHead = \(e: MouseEvent<HTMLElement>\) => \{\s*if \(e\.button !== 0 \|\| onButton\(e\)\) return;[^]*?if \(e\.detail !== 1\) return;\s*e\.preventDefault\(\);\s*void notesWindowDrag\(\)/);
  });
  it('머리 더블클릭은 맥처럼 두 번째 누름을 뗄 때, 그 자리에서 안 움직였을 때만 — 단추 위는 빼고', () => {
    expect(card).toMatch(/if \(e\.detail === 2\) \{ dbl\.current = \[e\.clientX, e\.clientY\]; return; \}/);
    expect(card).toMatch(/const upHead = \(e: MouseEvent<HTMLElement>\) => \{\s*const a = dbl\.current;\s*dbl\.current = null;\s*if \(e\.button !== 0 \|\| e\.detail !== 2 \|\| !a \|\| a\[0\] !== e\.clientX \|\| a\[1\] !== e\.clientY \|\| onButton\(e\)\) return;\s*void notesWindowDouble\(\)/);
  });
  it('더블클릭 동작은 맥 설정(AppleActionOnDoubleClick)을 그때그때 읽는다 — 확대·최소화·안 함', () => {
    expect(notesRs).toMatch(/pub fn notes_window_double<R: Runtime>\(window: tauri::WebviewWindow<R>\) \{\s*if !is_notes\(window\.label\(\)\) \{\s*return;\s*\}\s*match double_click\(\) \{/);
    expect(notesRs).toMatch(/"AppleActionOnDoubleClick"/);
    expect(mainRs).toMatch(/notes_window::notes_window_double,/);
  });
  it('끌기는 메모 창만 시작하는 앱 명령으로(권한 파일이 없어 data-tauri-drag-region 은 막힌다), 비활성 창도 첫 누름에 끌린다', () => {
    expect(notesRs).toMatch(/pub fn notes_window_drag<R: Runtime>\(window: tauri::WebviewWindow<R>\) \{\s*if is_notes\(window\.label\(\)\) \{\s*let _ = window\.start_dragging\(\);/);
    expect(mainRs).toMatch(/notes_window::notes_window_drag,/);
    expect(notesRs).toMatch(/\.accept_first_mouse\(true\)/);
  });
});

describe('패널 폭·여백', () => {
  it('패널 왼쪽 경계 손잡이 — 작업 패널과 같은 Grip, 폭은 기억', () => {
    expect(panel).toMatch(/<Grip width=\{w\} onWidth=\{setW\} min=\{NOTE_W_MIN\} max=\{NOTE_W_MAX\}/);
    expect(panel).toMatch(/localStorage\.setItem\(W_KEY/);
  });
  it('글 칸 좌우 여백이 좁다(블록 손잡이 자리 왼쪽 22 이하·오른쪽 10 이하)', () => {
    const m = css.match(/\.nt-doc \.cv-doc-body \{[^}]*padding: \d+px (\d+)px \d+px (\d+)px/);
    expect(Number(m?.[1])).toBeLessThanOrEqual(10);
    expect(Number(m?.[2])).toBeLessThanOrEqual(22);
  });
});

describe('여는 자리', () => {
  const on = { tama: true, office: true, voice: true, review: true };
  it('머리줄 종 왼쪽, 채팅·터미널 뷰 같은 자리', () => {
    for (const v of ['chat', 'terminal'] as const) expect(barItems(v, on).after.slice(-2)).toEqual(['notes', 'inbox']);
    expect(top).toContain('onNotes');
  });
  it('⌘⇧M — ⌘M(프로젝트 메모)과 따로', () => {
    expect(shortcutFor({ key: 'M', metaKey: true, ctrlKey: false, altKey: false, shiftKey: true } as KeyboardEvent)).toEqual({ type: 'notes' });
    expect(shortcutFor({ key: 'm', metaKey: true, ctrlKey: false, altKey: false, shiftKey: false } as KeyboardEvent)).toEqual({ type: 'memo' });
    expect(mainRs).toMatch(/item\("notes", .*CmdOrCtrl\+Shift\+M/);
  });
  it('패널은 스페이스 칸 바깥(참모를 바꿔도 안 사라지는 자리)에 그린다', () => {
    expect(space).toMatch(/<\/main>\s*\{\/\*[^*]*\*\/\}\s*\{notes\?\.open && <NotesSlot /);
  });
});
