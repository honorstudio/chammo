// 폰 화면 메모리 — 화면(대시보드·예약 판)을 오가면 컴포넌트가 내려갔다 올라오며 받은 값을 버리고 처음부터 다시 받아
// 한 박자(서버 한 번 왕복, LTE 300ms 흉내에서 310~330ms, 썸네일은 두 번 왕복 630ms+) 늦게 그려졌다(2026-10-03 사용자).
// 마지막 값은 여기 들고 있다가 바로 그리고, 뒤에서 새로 받아 바뀐 것만 간다(대가: 돌아온 직후 폴링 한 번 사이는 이전 값)
const values = new Map<string, unknown>();
export const remembered = <T>(key: string) => values.get(key) as T | undefined;
export const remember = (key: string, v: unknown) => { values.set(key, v); };

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
