import { createExtension } from "@blocknote/core";
import type { BlockNoteEditor } from "@blocknote/core";

// project-a 캔버스(src/presentation/canvas/canvasListBackspace.ts)에서 가져옴 — 스페이스는 기본 블록만 써서 편집기 타입만 바꿨다
type CanvasEditorInstance = BlockNoteEditor;

/**
 * 빈 리스트 아이템에서 Backspace 를 눌렀을 때 "그 줄만 지운다".
 *
 * ─ 왜 필요한가 ────────────────────────────────────────────────
 * BlockNote 기본 Backspace 는 우선순위 체인이고, 우리가 원하는 "삭제"(= 이전 블록과
 * 병합)는 그 체인의 5번째다. 그런데 그 앞에 두 개가 먼저 걸린다
 * (`@blocknote/core` KeyboardShortcutsExtension):
 *
 *   3번: 블록 시작 + paragraph 아님  → 블록을 `paragraph` 로 변환
 *   4번: 블록 시작                    → `liftItem()` 으로 한 단계 내어쓰기
 *
 * 그래서 실제로는 이렇게 된다:
 *   - 3번 때문에 목록부호가 풀리고, 리스트가 앞/뒤로 쪼개져 뒤 항목 번호가 1부터 다시 센다.
 *   - 4번은 깊이(depth) 검사가 없어서(라이브러리에 `canUnnestBlock` 이 있는데도 이 경로에선
 *     안 쓴다) 중첩돼 있으면 5번에 영영 도달하지 못하고, 누를 때마다 한 겹씩 올라가
 *     토글 같은 상위 컨테이너 밖 최상위까지 튀어나온다.
 *   - 게다가 `liftItem` → `liftToOuterList` 는 "뒤에 남은 형제는 올라가는 항목의 자식이
 *     된다"가 정상 동작이라, 건드리지도 않은 다음 항목까지 딸려 나온다.
 *
 * ─ 어떻게 고치나 ──────────────────────────────────────────────
 * BlockNote 자체 확장의 keymap 은 priority 101 로 등록되고 기본 단축키 확장은 50 이라,
 * 이 핸들러가 먼저 잡는다. 우리가 다루는 경우만 처리하고 `true` 를 반환해 체인을 끊고,
 * 나머지는 전부 `false` 로 기본 동작에 그대로 넘긴다(라이브러리 포크 없음).
 *
 * 내어쓰기는 Shift+Tab 이 계속 담당한다 — Backspace 에서만 떼어낸 것이다.
 */

/** Backspace 로 "줄 삭제"를 적용할 블록 타입. 그 외에는 기본 동작에 맡긴다. */
const LIST_BLOCK_TYPES = new Set([
  "numberedListItem",
  "bulletListItem",
  "checkListItem",
  "toggleListItem",
]);

type CanvasBlock = CanvasEditorInstance["document"][number];
type CanvasPartialBlock = Parameters<
  CanvasEditorInstance["insertBlocks"]
>[0][number];

/**
 * 옮겨 붙일 블록에서 id 를 떼어낸다.
 *
 * 자식을 이전 형제 밑에 먼저 넣고 원본을 지우는 순서라, id 를 그대로 두면 같은 id 가
 * 문서에 잠깐 둘 존재한다. 그 상태에서 id 로 블록을 찾으면 어느 쪽이 걸릴지 알 수 없어
 * 엉뚱한 블록이 지워질 수 있다. 새 id 는 BlockNote 가 발급한다.
 */
function withoutIds(blocks: readonly CanvasBlock[]): CanvasPartialBlock[] {
  return blocks.map((block) => {
    const copy: Record<string, unknown> = { ...block };
    delete copy.id;

    const children = (block as { children?: CanvasBlock[] }).children;
    if (children?.length) {
      copy.children = withoutIds(children);
    } else {
      delete copy.children;
    }

    return copy as CanvasPartialBlock;
  });
}

/** 그 블록 타입이 글자 커서를 받을 수 있는지 (구분선·이미지 등은 못 받는다). */
function acceptsTextCursor(
  editor: CanvasEditorInstance,
  blockType: CanvasBlock["type"],
): boolean {
  return editor.schema.blockSchema[blockType]?.content === "inline";
}

/**
 * 처리했으면 `true`(기본 Backspace 체인을 막는다), 아니면 `false`(기본 동작에 넘긴다).
 */
export function handleListBackspace(editor: CanvasEditorInstance): boolean {
  // 범위를 선택한 상태면 "선택 영역 삭제"가 맞다 — 기본 동작에 맡긴다.
  if (!editor.transact((tr) => tr.selection.empty)) {
    return false;
  }

  const { block, prevBlock } = editor.getTextCursorPosition();

  if (!LIST_BLOCK_TYPES.has(block.type)) {
    return false;
  }

  // 글자가 남아 있으면 평범한 글자 지우기다. 빈 줄일 때만 가로챈다.
  const content = block.content;
  if (!Array.isArray(content) || content.length > 0) {
    return false;
  }

  // 같은 깊이의 이전 형제가 없으면(리스트의 첫 줄) 커서를 옮길 곳이 없다.
  // 이때는 기본 동작(내어쓰기 / 위 블록과 병합)이 맞다.
  if (!prevBlock || !acceptsTextCursor(editor, prevBlock.type)) {
    return false;
  }

  const children = (block.children ?? []) as CanvasBlock[];
  const prevChildren = (prevBlock.children ?? []) as CanvasBlock[];
  const prevBlockId = prevBlock.id;

  // 세 조작을 한 트랜잭션으로 묶어 undo 한 번에 되돌아가게 한다.
  editor.transact(() => {
    if (children.length > 0) {
      // 지워지는 줄의 하위 목록은 잃지 않고 이전 형제 밑으로 옮긴다.
      // 이전 형제가 이미 자식을 갖고 있으면 그 뒤에 이어 붙인다.
      //
      // ⚠️ `insertBlocks` 로는 못 한다 — placement 가 "before" | "after" 뿐이라
      // 남의 자식으로 넣을 방법이 없고, 없는 값을 주면 조용히 "before" 로 떨어져
      // 엉뚱한 위치에 꽂힌다. 자식 목록은 `updateBlock` 으로 통째 교체한다.
      editor.updateBlock(prevBlockId, {
        children: [
          ...(prevChildren as unknown as CanvasPartialBlock[]),
          ...withoutIds(children),
        ],
      });
    }

    // 원본(그리고 원본에 달린 자식)을 통째로 제거한다.
    editor.removeBlocks([block.id]);

    // 커서는 지운 줄 바로 위 끝으로 — 이어서 타이핑되게.
    editor.setTextCursorPosition(prevBlockId, "end");
  });

  return true;
}

/**
 * 캔버스 에디터에 얹는 확장. `useCreateBlockNote({ extensions: [CanvasListBackspace] })`.
 */
export const CanvasListBackspace = createExtension({
  key: "canvasListBackspace",
  keyboardShortcuts: {
    Backspace: ({ editor }) =>
      handleListBackspace(editor as CanvasEditorInstance),
  },
});
