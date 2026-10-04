// 새 버전 알림 — 앱을 켤 때(그리고 몇 시간마다) 최신 Claude Code·Chammo 를 보고, 옛것이면 화면 위 띠로 늘 알린다(2026-10-01 사용자:
// "설정에서가 아니라 감지되면 항상 떠야"). 최신 번호는 npm 레지스트리(Claude Code)·GitHub 릴리스(Chammo) 공개 주소에서 — 판단만 여기

/** "2.1.283 (Claude Code)"·"v0.2.3" → [2,1,283]. 못 읽으면 null */
function parts(v: string): number[] | null {
  const m = /(\d+)\.(\d+)\.(\d+)/.exec(v);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** 화면에 보일 번호만 — "2.1.288 (Claude Code)" 꼬리를 떼야 "(지금 …)" 안에서 괄호가 안 겹친다. 못 읽으면 다듬은 원문 */
export const verLabel = (v: string): string => parts(v)?.join('.') ?? v.trim();

/** Claude Code 새 버전 띠 문구 [한글, 영어] */
export const claudeUpdateNote = (latest: string, cur: string): [string, string] => [
  `Claude Code ${latest} 이 나왔어요 (지금 ${verLabel(cur)}). 올리면 새로 띄우는 세션부터 새 버전으로 돌아요.`,
  `Claude Code ${latest} is out (you have ${verLabel(cur)}). New sessions use it after the update.`,
];

/** a<b 면 음수, 같으면 0, a>b 면 양수. 하나라도 못 읽으면 0(같다고 봐서 알리지 않는다) */
export function cmpVer(a: string, b: string): number {
  const x = parts(a), y = parts(b);
  if (!x || !y) return 0;
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i]! - y[i]!;
  return 0;
}

/** Claude Code 가 최신보다 옛것이면 최신 번호, 아니면(같음·새것·최신 모름) null */
export const claudeBehind = (cur: string, latest: string | undefined): string | null =>
  latest && cmpVer(cur, latest) < 0 ? latest : null;

export type LatestApp = { version: string; url: string; page: string };

type Rel = { tag_name?: unknown; html_url?: unknown; draft?: unknown; prerelease?: unknown; assets?: { name?: unknown; browser_download_url?: unknown }[] };

/** GitHub 최신 릴리스 응답 → 이 기기 설치 파일 주소(맥 dmg, 윈도우 setup.exe, 없으면 릴리스 페이지). 초안·미리보기·오류 응답은 null */
export function parseLatestApp(rel: unknown, win: boolean): LatestApp | null {
  const r = rel as Rel | null;
  if (!r || typeof r.tag_name !== 'string' || typeof r.html_url !== 'string' || r.draft || r.prerelease) return null;
  const want = win ? /_x64-setup\.exe$/ : /_aarch64\.dmg$/;
  const a = (r.assets ?? []).find((x) => typeof x.name === 'string' && want.test(x.name));
  const url = typeof a?.browser_download_url === 'string' ? a.browser_download_url : r.html_url;
  return { version: r.tag_name.replace(/^v/, ''), url, page: r.html_url };
}

/** 이 앱보다 새 Chammo 가 있으면 그 정보, 아니면 null */
export const appUpdate = (cur: string, latest: LatestApp | null): LatestApp | null =>
  latest && cmpVer(cur, latest.version) < 0 ? latest : null;
