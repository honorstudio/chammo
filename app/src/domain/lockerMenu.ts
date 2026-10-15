// 보관함 오른쪽 클릭 메뉴(2026-10-12 사용자 "우클릭을 습관적으로 하게 된다") — 그 자리에서 되는 것만, 묶음마다 줄로 나눈다.
// 카드 ··· 메뉴도 같은 목록을 쓴다(ui/space/LockerPage). 항목 이름·실행은 화면 쪽, 여기는 무엇이 뜨나만(시험: lockerMenu.test.ts)

export type LockerMenuKey =
  | 'open' | 'big' | 'send'
  | 'alias' | 'move' | 'keep' | 'back' | 'rename' | 'vers' | 'find'
  | 'newFolder' | 'newDoc' | 'newSheet' | 'add'
  | 'reveal' | 'trash' | 'unlink' | 'close'
  /** 마지막 휴지통 묶음 되돌리기(2026-10-12 사고 — 앱을 다시 켜도) */
  | 'untrash'
  /** 맥 폴더 연결: 새로 잇기 · 끊긴 걸 다시 잇기 · 풀기(링크만 지운다, 원본은 그대로) */
  | 'connect' | 'reconnect' | 'disconnect';

/** 보관함 줄의 모양 — 집 파일·바로가기·끊긴 바로가기. 이사 간 파일을 가리키는 바로가기면 givenBack */
type EntryLook = { link: boolean; gone: boolean; vers: number; givenBack: boolean; /** 연결 폴더 안쪽 파일 — 읽기만 */ ro?: boolean };

export type LockerSpot =
  /** 카드·목록 줄·기록 줄. entry = null 이면 보관함 밖(보여 준 파일). folders = 내 폴더 수(바로가기를 만들 곳) */
  | { kind: 'file'; entry: EntryLook | null; folders: number }
  /** 나무 폴더 줄·폴더 카드. link = 맥 폴더 연결(ok·원본 없음 gone), ro = 연결 폴더 안쪽 폴더 */
  | { kind: 'folder'; link?: 'ok' | 'gone'; ro?: boolean }
  /** 보관함·폴더 화면 빈 곳, 나무의 '보관함' 줄. ro = 연결 폴더 안(새로 만들 수 없다), untrash = 되돌릴 휴지통 묶음이 있다 */
  | { kind: 'blank'; ro?: boolean; untrash?: boolean }
  /** 탭 줄의 파일 탭 */
  | { kind: 'tab'; inLocker: boolean };

const nonEmpty = (g: LockerMenuKey[][]) => g.filter((x) => x.length > 0);

export function lockerMenu(s: LockerSpot): LockerMenuKey[][] {
  if (s.kind === 'folder') {
    if (s.link === 'gone') return [['reconnect'], ['rename'], ['disconnect']];
    if (s.link) return [['open'], ['move', 'rename'], ['reveal'], ['disconnect']];
    if (s.ro) return [['open'], ['reveal'], ['trash']]; // 연결 폴더 안쪽 — 맥 휴지통만 열린다(이름·옮기기는 그대로 막힘)
    return [['open'], ['newFolder', 'newDoc'], ['move', 'rename'], ['reveal'], ['trash']];
  }
  if (s.kind === 'blank') return [...(s.ro ? [] : [['newFolder', 'newDoc', 'newSheet', 'add', 'connect'] as LockerMenuKey[]]), ['reveal'], ...(s.untrash ? [['untrash'] as LockerMenuKey[]] : [])];
  if (s.kind === 'tab') return [['big', 'send'], [s.inLocker ? 'reveal' : 'keep'], ['close']];
  const e = s.entry;
  const alias: LockerMenuKey[] = s.folders > 0 ? ['alias'] : [];
  if (!e) return nonEmpty([['open', 'big', 'send'], [...alias, 'keep']]);
  if (e.ro) return nonEmpty([['open', 'big', 'send'], [...alias, 'keep'], ['reveal'], ['trash']]);
  if (e.gone) return [[...(e.link ? ['find' as const] : [])], ['rename'], [e.link ? 'unlink' : 'trash']].filter((g) => g.length > 0) as LockerMenuKey[][];
  return [
    ['open', 'big', 'send'],
    [...alias, 'move', ...(e.givenBack ? ['back' as const] : []), 'rename', ...(!e.link && e.vers > 1 ? ['vers' as const] : [])],
    ['reveal'],
    [e.link ? 'unlink' : 'trash'],
  ];
}

const parentOf = (rel: string) => (rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '');

/** '옮기기' 다음 목록 — 맨 위(보관함, 빈 글) + 내 폴더. 지금 있는 폴더는 빼고, 폴더는 자기 자신·자기 안으로 못 간다(나무 칸을 없앤 뒤 옮기는 길, 2026-10-12) */
export function moveTargets(rel: string, folders: { rel: string }[]): string[] {
  const here = parentOf(rel);
  return ['', ...folders.map((f) => f.rel)].filter((t) => t !== here && t !== rel && !t.startsWith(`${rel}/`));
}
