// 폰 화면 메모리 — 화면(대시보드·예약 판)을 오가면 컴포넌트가 내려갔다 올라오며 받은 값을 버리고 처음부터 다시 받아
// 한 박자(서버 한 번 왕복, LTE 300ms 흉내에서 310~330ms, 썸네일은 두 번 왕복 630ms+) 늦게 그려졌다(2026-10-03 사용자).
// 마지막 값은 여기 들고 있다가 바로 그리고, 뒤에서 새로 받아 바뀐 것만 간다(대가: 돌아온 직후 폴링 한 번 사이는 이전 값)
const values = new Map<string, unknown>();

// 페이지가 다시 떠도 남길 열쇠 — 아이폰 홈 화면 앱은 뒤로 갔다 오면 자주 새로 떠서 메모리가 빈다. 그러면 참모 바꾸기 시트가
// 고정 없는 기본 순서·기본 색으로 먼저 그렸다가 맥 답이 오면 다시 맞췄다(2026-11-16 사용자 "잠깐 초기화 상태에서 맞춰져서 UX 안 좋음").
// 작은 설정 글만(고정·순서·맡은 일·기기 목록) — 대화·파일 목록 같은 큰 것은 메모리에만
export const KEEP_KEYS = new Set(['pins', 'order', 'roles', 'far']);
const KEEP_PREFIX = 'chammo.memo.';
const disk = (): Storage | null => { try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; } };

export const remembered = <T>(key: string): T | undefined => {
  if (values.has(key)) return values.get(key) as T;
  if (!KEEP_KEYS.has(key)) return undefined;
  try {
    const raw = disk()?.getItem(KEEP_PREFIX + key);
    if (raw == null) return undefined;
    const v = JSON.parse(raw) as T;
    values.set(key, v);
    return v;
  } catch { return undefined; } // 망가진 글 — 기억 없음으로
};
export const remember = (key: string, v: unknown) => {
  const same = values.has(key) && JSON.stringify(values.get(key)) === JSON.stringify(v);
  values.set(key, v);
  if (!KEEP_KEYS.has(key) || same) return;
  try { disk()?.setItem(KEEP_PREFIX + key, JSON.stringify(v)); } catch { /* 개인 정보 보호 모드 — 이번 실행 메모리만 */ }
};

/** 썸네일 blob 주소 — 가장 오래 안 쓴 것부터 놓는다(놓을 때 revoke) */
export class BlobMemo {
  private m = new Map<string, string>();
  constructor(private max: number, private drop: (url: string) => void) {}
  get(k: string): string | undefined {
    const v = this.m.get(k);
    if (v !== undefined) { this.m.delete(k); this.m.set(k, v); }
    return v;
  }
  put(k: string, url: string) {
    const old = this.m.get(k);
    if (old !== undefined && old !== url) this.drop(old);
    this.m.delete(k);
    this.m.set(k, url);
    while (this.m.size > this.max) {
      const [first, u] = this.m.entries().next().value as [string, string];
      this.m.delete(first);
      this.drop(u);
    }
  }
}
