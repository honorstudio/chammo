// 커밋 줄 수에 무엇을 넣나 — 표는 여기 한 곳. 위 막대 '오늘 커밋'·다마고치 먹이·하루 리플레이·리뷰 화면 생성물 칸이 같이 쓴다.
// 기준은 work-stats 스킬(collect.py)의 걸러내기와 같다: 사람이 쓴 코드가 아닌 것은 넣으면 통계가 통째로 뒤집힌다
// (2026-11-02 한 저장소의 .ai 두 개가 하루 300만 줄 — .ai 는 글자 PostScript 라 git numstat 이 줄로 센다)

/** numstat 경로를 판정용으로 — git 은 한글 경로를 "…\354…" 따옴표로 감싸고(core.quotePath), 이름 바꾸기는 `a/{old => new}/f`·`old => new` 로 준다. 바뀐 뒤 이름만 본다 */
const plainPath = (p: string) => p.replace(/^"(.*)"$/, '$1').replace(/\{[^{}]* => ([^{}]*)\}/g, '$1').replace(/^.* => /, '').replace(/\/\/+/g, '/');

// 커밋 크기 규칙이 예외로 인정하는 자동 생성물 — lock(복사본 변형 포함)·빌드 결과·스키마 타입·마이그레이션·스냅샷
const GENERATED = /(^|\/)(package-lock|pnpm-lock|yarn|composer|Podfile|Gemfile|Cargo)[^/]*\.(json|lock|yaml)$|(^|\/)[^/]+\.lock$|(^|\/)(dist|build)\/|\.min\.(js|css)$|(\.types|\.generated|\.gen)\.[a-z]+$|(^|\/)migrations\/[^/]+\.sql$|(^|\/)__snapshots__\//i;
export const isGeneratedPath = (p: string) => GENERATED.test(plainPath(p));

// 코드가 아닌 파일 — 디자인 원본·문서 바이너리·압축·소스맵·로그
const NON_CODE_EXT = ['ai', 'eps', 'pdf', 'psd', 'svg', 'vectorcraft', 'sketch', 'fig', 'indd', 'xd', 'map', 'log', 'zip', 'gz', 'tgz', '7z', 'rar', 'dmg'];
const NON_CODE = new RegExp(`\\.(${NON_CODE_EXT.join('|')})$`, 'i');
// 통째로 들여온 남의 코드·도구 산출물 폴더
const VENDORED = /(^|\/)(node_modules|Pods|vendor|\.next|coverage|reference|backup|legacy[^/]*)\//i;

/** 줄 수에 넣는 파일인가 — 생성물·디자인·남의 코드는 뺀다 */
export function isCodePath(path: string): boolean {
  const p = plainPath(path);
  return !GENERATED.test(p) && !NON_CODE.test(p) && !VENDORED.test(p);
}
