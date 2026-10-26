// 팀 보관함 기다리는 일(낙관적 반영) — 누르면 받은 목록 위에 바로 얹어 그리고, 서버 답이 오면 새 목록으로 갈아 끼운 뒤 뗀다.
// 실패하면 떼기만 하면 받은 목록 그대로 되돌아간다(받은 목록은 안 건드린다). 10-26 사용자 298.png "폴더 만드는데 한참 — 하나 더 만들 뻔"
import { tr } from '../i18n';
import type { LockerItem } from './teamLocker';

export type LockerOp =
  | { k: 'mkdir'; folder: string }
  /** 폴더 이름 바꾸기(to) · 지우기(to null — 안의 파일은 휴지통) */
  | { k: 'folder'; from: string; to: string | null }
  /** 파일 이름 바꾸기·폴더로 옮기기(folder '' = 맨 위) */
  | { k: 'meta'; id: string; name?: string; folder?: string }
  | { k: 'act'; id: string; verb: 'trash' | 'restore' | 'purge' };

/** 같은 일 열쇠 — 같은 줄·같은 폴더에 기다리는 일이 있으면 또 누른 건 안 보낸다(연타 한 번만) */
export function opKey(op: LockerOp): string {
  if (op.k === 'mkdir') return `dir:${op.folder.trim()}`;
  if (op.k === 'folder') return `dir:${op.from}`;
  return `file:${op.id}`;
}

const inFolder = (i: LockerItem, f: string) => i.state === 'live' && !i.room && i.folder === f;

/** 받은 목록 + 기다리는 일 → 그릴 목록과 '반영 중' 표시(줄 id·폴더 이름) */
export function withPending(items: LockerItem[], ops: LockerOp[], now = Date.now()): { items: LockerItem[]; busy: Set<string>; busyFolders: Set<string> } {
  const busy = new Set<string>();
  const busyFolders = new Set<string>();
  if (!ops.length) return { items, busy, busyFolders };
  let out = items.map((i) => ({ ...i }));
  for (const op of ops) {
    if (op.k === 'mkdir') {
      const f = op.folder.trim();
      busyFolders.add(f);
      if (!out.some((i) => inFolder(i, f))) out.push({ id: `pending:${f}`, name: '', size: 0, cipher: 0, at: now, state: 'live', kind: 'file', room: '', folder: f, by: '', byMember: '', mine: true, why: '', deletedAt: null, dir: true });
    } else if (op.k === 'folder') {
      if (op.to) busyFolders.add(op.to);
      for (const i of out) if (inFolder(i, op.from)) Object.assign(i, op.to ? { folder: op.to } : { state: 'trash', deletedAt: now });
    } else if (op.k === 'meta') {
      busy.add(op.id);
      out = out.map((i) => (i.id === op.id ? { ...i, ...(op.name !== undefined ? { name: op.name } : {}), ...(op.folder !== undefined ? { folder: op.folder } : {}) } : i));
    } else {
      busy.add(op.id);
      out = op.verb === 'purge'
        ? out.filter((i) => i.id !== op.id)
        : out.map((i) => (i.id === op.id ? { ...i, state: op.verb === 'trash' ? 'trash' : 'live', deletedAt: op.verb === 'trash' ? now : null } : i));
    }
  }
  return { items: out, busy, busyFolders };
}

/** 실패 알림 — 무엇이 안 됐는지 먼저, 서버·망 이유는 뒤에 */
export function failText(op: LockerOp, why: string): string {
  const what = op.k === 'mkdir' ? tr(`'${op.folder.trim()}' 폴더를 못 만들었어요`, `Couldn't create folder '${op.folder.trim()}'`)
    : op.k === 'folder' ? (op.to ? tr(`'${op.from}' 폴더 이름을 못 바꿨어요`, `Couldn't rename folder '${op.from}'`) : tr(`'${op.from}' 폴더를 못 지웠어요`, `Couldn't delete folder '${op.from}'`))
    : op.k === 'meta' ? (op.name !== undefined ? tr('이름을 못 바꿨어요', "Couldn't rename") : op.folder ? tr(`'${op.folder}' 폴더로 못 옮겼어요`, `Couldn't move to '${op.folder}'`) : tr('맨 위로 못 옮겼어요', "Couldn't move to the top"))
    : op.verb === 'trash' ? tr('휴지통으로 못 옮겼어요', "Couldn't move to the trash")
    : op.verb === 'restore' ? tr('못 되살렸어요', "Couldn't restore")
    : tr('영구로 못 지웠어요', "Couldn't delete forever");
  return `${what} — ${why.replace(/^Error:\s*/, '')}`;
}
