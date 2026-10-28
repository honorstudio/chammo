// 앱 서랍(2026-10-17 사용자 '앱 서랍' — v3 덱 1, 런치패드처럼 아이콘 격자) — 13개 Craft 앱: 깔린 것·깔 수 있는 것.
// 아이콘 아래 이름 한 줄, 판·크기·마지막 사용은 마우스를 올리면(title). 안 깐 앱은 흐리게 + '받기'
import { tr } from '../i18n';

export type DrawerRow = {
  app: string; name: string; what: string; installed: string | null; mine: boolean; size: number; used: string | null;
  latest: string | null; dmgSize: number | null; icon: string;
  /** 깔린 판보다 릴리스가 더 새것(숫자로 견줌 — scripts/craft). 우리가 깐 앱은 다음에 열 때 저절로 바뀐다 */
  newer?: boolean;
  /** 라이선스 창 — 원작(ArtCraft) 이름·저장소, 참모 앱이면 원작 판(Info.plist ChammoBasedOn) */
  origName: string; repo: string; basedOn: string | null; chammo: boolean;
  /** 안 깔렸는데 받을 수 없을 때 까닭 한 줄(공개 릴리스를 못 받음·릴리스에 없음) — 모르면 비움 */
  unavailable?: string | null;
  /** 미리 깔아 두는 기본 다섯(표·PDF·슬라이드·문서·벡터 — scripts/craft BASICS) · 지금 뒤에서 받는 중(prefetch) */
  basic?: boolean; prefetching?: boolean;
};

export const APPS_KEY = 'k:@apps';

/** Rust(platform::NO_PYTHON) — 윈도우에 파이썬 3 이 없어 scripts/craft 를 못 돌린다 */
export const NO_PYTHON = 'no-python';

/** 서랍·참모 앱 열기 오류 → 파이썬이 없으면 설치 안내 한 줄(원문은 일반 사용자가 못 읽는다), 그 밖은 원문 그대로 */
export function craftErr(e: unknown): { python: boolean; text: string } {
  const t = (e instanceof Error ? e.message : String(e ?? '')).trim();
  if (t === NO_PYTHON) return { python: true, text: tr('참모 앱을 쓰려면 파이썬 3 이 필요해요', 'Chammo apps need Python 3') };
  // 빈 오류(종료 코드만)면 서랍이 오류 줄도 목록도 없이 자리표시에 멈췄다(10-28) — 한 줄은 꼭
  return { python: false, text: t || tr('앱 목록을 못 읽었어요', 'Could not read the app list') };
}

/** 서랍 기억(10-28 사용자 '계속 로딩해야 할 이유가 있나') — 칸을 떠나면 서랍이 지워져 열 때마다 scripts/craft 를 새로 띄우고 기다렸다.
 *  마지막 목록을 이번 실행은 메모리, 앱을 다시 켜도 남게 저장소에(막혀 있으면 메모리만) — 열면 바로 그리고 뒤에서 새로 읽는다 */
export const DRAWER_MEMO_KEY = 'craftDrawer:rows';
type Store = Pick<Storage, 'getItem' | 'setItem'>;
export function drawerMemo(store?: Store) {
  let mem: DrawerRow[] | null = null;
  return {
    load(): DrawerRow[] | null {
      if (mem) return mem;
      try {
        const v: unknown = JSON.parse(store?.getItem(DRAWER_MEMO_KEY) ?? 'null');
        if (Array.isArray(v) && v.length && v.every((r) => r && typeof r.app === 'string' && typeof r.name === 'string')) mem = v as DrawerRow[];
      } catch { /* 깨진 기록은 없는 것으로 */ }
      return mem;
    },
    save(rows: DrawerRow[]) {
      mem = rows;
      try { store?.setItem(DRAWER_MEMO_KEY, JSON.stringify(rows)); } catch { /* 저장소가 막혔으면 메모리만 */ }
    },
  };
}

/** 새로 읽은 목록 — 안 바뀐 칸은 옛 것 그대로(하나도 안 바뀌었으면 옛 배열째 — 다시 그리지 않게) */
export function mergeRows(old: DrawerRow[] | null, next: DrawerRow[]): DrawerRow[] {
  if (!old) return next;
  const was = new Map(old.map((r) => [r.app, r]));
  const out = next.map((r) => { const o = was.get(r.app); return o && JSON.stringify(o) === JSON.stringify(r) ? o : r; });
  return out.length === old.length && out.every((r, i) => r === old[i]) ? old : out;
}

/** 서랍 본문 — 목록이 있으면 목록(오류는 위에 한 줄), 없고 오류면 오류 한 줄 + 다시 시도, 둘 다 없을 때(처음 읽는 중)만 자리표시 */
export const drawerView = (rows: DrawerRow[] | null, err: string): 'rows' | 'error' | 'skeleton' => (rows ? 'rows' : err ? 'error' : 'skeleton');

/** 사람이 읽는 크기 */
export function sizeText(n: number | null | undefined): string {
  if (!n) return '';
  const mb = n / 1024 / 1024;
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)}GB` : `${Math.max(1, Math.round(mb))}MB`;
}

/** 깔린 것 · 깔 수 있는 것 — 표 순서 그대로 */
export function splitRows(rows: DrawerRow[]): { have: DrawerRow[]; can: DrawerRow[] } {
  return { have: rows.filter((r) => r.installed), can: rows.filter((r) => !r.installed) };
}

/** 이 맥에서 차지하는 크기(우리가 깐 것 + 설정·작업 폴더) */
export const usedTotal = (rows: DrawerRow[]) => rows.reduce((a, r) => a + (r.size || 0), 0);

/** 서랍 아래 크기 줄 — 그 기기 이름으로(맥·윈도우) */
export const usedLine = (n: number, win: boolean) => {
  const s = sizeText(n) || '0MB';
  return win ? tr(`이 PC 에서 ${s}`, `${s} on this PC`) : tr(`이 맥에서 ${s}`, `${s} on this Mac`);
};

/** 올렸을 때 글 — 깔린 것: 판·크기·마지막 사용, 새 판이 있으면 알림 / 깔 수 있는 것: 판·받을 크기 */
export function tileTitle(r: DrawerRow): string {
  const parts = [r.name, r.what, r.basic ? tr('기본 앱', 'basic app') : ''];
  if (r.prefetching) parts.push(tr('미리 받는 중', 'installing ahead'));
  if (r.installed) {
    parts.push(r.installed);
    if (r.size) parts.push(sizeText(r.size));
    parts.push(r.used ? tr(`마지막 사용 ${r.used}`, `last used ${r.used}`) : tr('아직 안 씀', 'not used yet'));
    if (r.newer && r.latest) parts.push(tr(`새 판 ${r.latest}`, `new ${r.latest}`));
  } else if (tileUnavailable(r)) {
    parts.push(tr(`받을 수 없음 — ${r.unavailable}`, `unavailable — ${r.unavailable}`));
  } else {
    if (r.latest) parts.push(r.latest);
    if (r.dmgSize) parts.push(tr(`받기 ${sizeText(r.dmgSize)}`, `download ${sizeText(r.dmgSize)}`));
  }
  return parts.filter(Boolean).join(' · ');
}

/** 기본 앱을 뒤에서 받는 중인 칸이 있나 — 서랍이 그동안 목록을 다시 읽는다 */
export const prefetchingAny = (rows: DrawerRow[]): boolean => rows.some((r) => r.prefetching);

/** 받을 수 없는 칸이면 그 까닭(깔린 앱은 그대로 쓰니 null) */
export const tileUnavailable = (r: DrawerRow): string | null => (!r.installed && r.unavailable) || null;

/** 아이콘 — 받은 그림, 못 구했으면 참모 포토는 Chammo 아이콘(우리 앱이라), 나머지는 빈 칸(첫 글자 판) */
export const tileIcon = (r: DrawerRow) => r.icon || (r.app === 'photocraft' ? '/assets/icon-192.png' : '');

/** 참모 브라우저 아이콘(10-28 시안 A) — 사본 번들 아이콘(tools/chammo-browser/assets/browser-icon.svg)과 같은 그림, 작은 판은 32px 이하용 */
export const BROWSER_ICON = '/assets/chammo-browser.svg';
export const BROWSER_ICON_SMALL = '/assets/chammo-browser-small.svg';

/** 아이콘을 못 구했을 때 — 이름 첫 글자(참모 앱은 '참모' 뒤 — 13개가 다 '참'이면 칸이 안 갈린다) */
export const tileLetter = (r: DrawerRow) => (r.name.trim().replace(/^참모\s+/, '')[0] ?? '?').toUpperCase();

/** 칸 오른쪽 위 모서리(v7 A1, 마우스를 올리면) — 떠 있으면 끄기(지우기 대신 — 떠 있는 앱은 못 지운다), 안 떠 있고 우리가 깐 건 지우기 */
export function tileCorner(r: DrawerRow, running: boolean, elsewhere = false): 'quit' | 'remove' | null {
  if (running) return 'quit';
  // 다른 참모가 쓰는 중(elsewhere) — 서랍은 내 인스턴스만 켜짐으로 보여서 '안 떠 있음'으로 보였고, 지우기는 모든 인스턴스를 끄고 앱째 지운다(2026-10-21 리뷰)
  return r.mine && !elsewhere ? 'remove' : null;
}

/** 불러오는 동안 자리표시로 둘 칸 — 깔렸거나 판을 아는(로컬 DMG·받아 둔) 앱은 바로, 저장소에서 받아야 하는 칸만(v8 A2) */
export const tileLoading = (r: DrawerRow, loading: boolean) => loading && !r.installed && !r.latest;

/** 라이선스 창 줄 — 참모 앱(우리가 빌드한 판) 먼저, 그다음 원본 그대로(각자 표 순서) */
export const licenseRows = (rows: DrawerRow[]) => [...rows.filter((r) => r.chammo), ...rows.filter((r) => !r.chammo)];

/** 고지 파일(THIRD_PARTY_NOTICES.md) 절 — "## 이름 — 라이선스" 와 그 아래 본문 */
export function parseNotices(md: string): { name: string; license: string; body: string }[] {
  return md.split(/^## /m).slice(1).map((sec) => {
    const [head, ...rest] = sec.split('\n');
    const i = head!.lastIndexOf(' — ');
    return { name: (i < 0 ? head! : head!.slice(0, i)).trim(), license: i < 0 ? '' : head!.slice(i + 3).trim(), body: rest.join('\n').trim() };
  });
}

/** 라이선스 창 한 줄 글 — 참모 앱: 원작 이름·판(ChammoBasedOn 문장에서 판 번호만 — 앱마다 문장 모양이 달라서)·저장소, 원본: 원본 그대로·판·저장소 */
export function licenseLine(r: DrawerRow): string {
  if (r.chammo) {
    const v = r.basedOn?.match(/\d+\.\d+\.\d+/)?.[0];
    return tr(`원작 ${r.origName}${v ? ` ${v}` : ''} · ${r.repo}`, `based on ${r.origName}${v ? ` ${v}` : ''} · ${r.repo}`);
  }
  const v = r.installed ?? r.latest;
  return tr(`원본 그대로${v ? ` ${v}` : ''} · ${r.repo}`, `unchanged${v ? ` ${v}` : ''} · ${r.repo}`);
}
