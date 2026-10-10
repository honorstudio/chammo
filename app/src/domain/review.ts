// 리뷰·머지 — 참모가 CI 초록만 보고 넣던 PR 을 사용자가 보고 넣게(2026-09-27 사용자, 시안 docs/design-drafts/review-merge).
// 평소엔 작업 패널에 '머지 전에 볼 것'(아래 gates 에 걸린 열린 PR)과 '오늘 넣은 것', 자세히는 사이드바 '리뷰' 화면.
// gh 원문 파싱·판정·요약은 전부 여기(순수함수). gh 호출은 Rust review.rs
import { isGeneratedPath, isTestPath } from './tama/sources';
import { tr } from '../i18n';

export type PrFile = { path: string; additions: number; deletions: number };
export type CiState = 'pass' | 'fail' | 'running' | 'none';
export type Check = { name: string; state: CiState | 'skip'; url?: string };

export type OpenPr = {
  /** 'owner/name#번호' */
  key: string;
  repo: string;
  /** dev 아래 폴더 이름 */
  folder: string;
  number: number;
  /** GraphQL 노드 id */
  id: string;
  title: string;
  body: string;
  url: string;
  head: string;
  base: string;
  createdAt: string;
  updatedAt: string;
  draft: boolean;
  mergeable: string;
  additions: number;
  deletions: number;
  files: PrFile[];
  checks: Check[];
  /** 커밋 제목들 */
  commits: string[];
};

// ── 파일 묶음 ──

export type FileKind = 'code' | 'test' | 'db' | 'docs' | 'generated';
/** 보여 줄 이름 — 읽을 때마다 지금 언어로(열쇠 FileKind 는 그대로) */
export const FILE_KIND_LABEL: Readonly<Record<FileKind, string>> = {
  get code() { return tr('코드', 'Code'); },
  get test() { return tr('테스트', 'Tests'); },
  get db() { return 'DB'; },
  get docs() { return tr('문서·시안', 'Docs & drafts'); },
  get generated() { return tr('생성물', 'Generated'); },
};
const ORDER: FileKind[] = ['code', 'db', 'test', 'docs', 'generated'];

const DB_PATH = /(^|\/)migrations?\/|\.sql$/i;
const DOCS = /(^|\/)docs\/|\.(md|mdx|txt)$|(^|\/)(README|CHANGELOG|LICENSE)[^/]*$/i;

export function fileKind(path: string): FileKind {
  if (DB_PATH.test(path)) return 'db';
  if (isTestPath(path)) return 'test';
  if (isGeneratedPath(path)) return 'generated';
  if (DOCS.test(path)) return 'docs';
  return 'code';
}

export type FileGroup = { kind: FileKind; files: PrFile[]; additions: number; deletions: number };

export function groupFiles(files: PrFile[]): FileGroup[] {
  const by = new Map<FileKind, FileGroup>();
  for (const file of files) {
    const k = fileKind(file.path);
    const g = by.get(k) ?? { kind: k, files: [], additions: 0, deletions: 0 };
    g.files.push(file);
    g.additions += file.additions;
    g.deletions += file.deletions;
    by.set(k, g);
  }
  return ORDER.filter((k) => by.has(k)).map((k) => by.get(k)!);
}

// ── 사용자 확인 조건 = 되돌리기 어려운 것 (DB·돈·보안). 운영 배포는 뺀다 — project-a 는 머지 = 배포라 전부 걸린다 ──
// 2026-09-29 사용자: '+500줄'은 뺐다. 크기는 되돌리기 쉽다(Loops and Graphs — 문은 확신도·크기가 아니라 되돌리기 비용으로).
// 운영에 직접 손대는 순간(마이그 적용·운영 데이터 삭제·운영 배포)은 머지 전이라 여기 말고 scripts/task 의 OPS_RULE 이 막는다

export type GateKind = 'db' | 'money' | 'security';
export type Gate = { kind: GateKind; why: string };
export const GATE_LABEL: Readonly<Record<GateKind, string>> = {
  get db() { return tr('DB 변경', 'DB change'); },
  get money() { return tr('돈', 'Money'); },
  get security() { return tr('보안', 'Security'); },
};

// DB: 본문은 SQL 낱말만. '마이그레이션' 은 "마이그레이션은 없다"(#462)처럼 부정으로 자주 나와 제목에서만 본다
const DB_BODY = /\b(GRANT|REVOKE|RLS)\b|create policy|alter table|security definer/i;
const DB_TITLE = /마이그레이션|migration|\bRLS\b|\bGRANT\b|\bREVOKE\b|security definer|스키마/i;
// 돈: scripts/task 결제 관문(PAYMENT)과 같은 말. 영어는 낱말로만(discharge·recharge 제외).
// '결제 비중·결제 방식별' 처럼 결제를 세어 보여 주기만 하는 말은 뺀다(매출 화면 PR)
const MONEY_TEXT = /실결제|결제(?!\s*(비중|방식별|통계|건수|집계))|환불|과금|부트페이|bootpay|\b(payments?|refunds?|billing|charges?)\b/i;
const MONEY_PATH = /(^|[/_.-])(billing|payments?|refunds?|checkout|bootpay|subscriptions?)([/_.-]|$)/i;
// 보안: 본문은 키 이름(밑줄 붙은 환경변수 모양 — 게임 용어 "SECRET"(scene #48) 은 아님)·시크릿처럼 뚜렷한 것만.
// '권한' 은 "computer-use 권한 없음"(#392)처럼 스쳐 지나가서 제목에서만 본다
const SEC_ENV = /\b[A-Z][A-Z0-9]*_[A-Z0-9_]*(KEY|SECRET|TOKEN)\b/;
const SEC_WORD = /시크릿|환경변수|service_role|security definer/i;
const SEC_TITLE = /security definer|권한|보안|인증|security|secret|시크릿|토큰|token|\bRLS\b/i;
const SEC_PATH = /(^|\/)\.env|(^|\/)(secrets?|security|permissions?)(\/|\.)/i;

const quoted = (m: RegExpMatchArray | null) => (m ? `"${m[0]}"` : '');

export function gates(pr: OpenPr): Gate[] {
  const out: Gate[] = [];
  // 문서만 바꾼 PR 은 글이 결제·RLS·시크릿을 말해도 되돌리기 쉽다 — 세션 정리 PR 이 '돈'에 걸리던 것(문서 PR #87·#37)
  if (pr.files.length && pr.files.every((x) => fileKind(x.path) === 'docs')) return out;
  const text = `${pr.title}\n${pr.body}`;

  const dbFiles = pr.files.filter((x) => fileKind(x.path) === 'db');
  const dbWhy = dbFiles.length ? tr(`마이그레이션 ${dbFiles.length}개`, `${dbFiles.length} migration${dbFiles.length > 1 ? 's' : ''}`) : quoted(pr.title.match(DB_TITLE)) || quoted(pr.body.match(DB_BODY));
  if (dbWhy) out.push({ kind: 'db', why: dbWhy });

  const moneyWhy = quoted(text.match(MONEY_TEXT)) || (pr.files.find((x) => MONEY_PATH.test(x.path))?.path ?? '');
  if (moneyWhy) out.push({ kind: 'money', why: moneyWhy });

  const secWhy = quoted(pr.title.match(SEC_TITLE)) || (pr.body.match(SEC_ENV)?.[0] ?? '') || quoted(pr.body.match(SEC_WORD)) || (pr.files.find((x) => SEC_PATH.test(x.path))?.path ?? '');
  if (secWhy) out.push({ kind: 'security', why: secWhy });

  return out;
}

// ── CI ──

type RollupItem = { __typename?: string; name?: string; context?: string; status?: string; conclusion?: string; state?: string; detailsUrl?: string; targetUrl?: string };

const FAIL = new Set(['FAILURE', 'ERROR', 'CANCELLED', 'TIMED_OUT', 'ACTION_REQUIRED', 'STARTUP_FAILURE']);
const SKIP = new Set(['SKIPPED', 'NEUTRAL', 'STALE']);

/** gh statusCheckRollup — Actions(CheckRun)과 Vercel 같은 외부 상태(StatusContext)가 섞여 온다 */
export function parseChecks(rollup: unknown): Check[] {
  if (!Array.isArray(rollup)) return [];
  return (rollup as RollupItem[]).map((r) => {
    const name = r.name ?? r.context ?? '?';
    const url = r.detailsUrl ?? r.targetUrl;
    let state: Check['state'];
    if (r.__typename === 'StatusContext') {
      state = r.state === 'SUCCESS' ? 'pass' : FAIL.has(r.state ?? '') || r.state === 'FAILURE' ? 'fail' : 'running';
    } else if (r.status !== 'COMPLETED') state = 'running';
    else if (FAIL.has(r.conclusion ?? '')) state = 'fail';
    else if (SKIP.has(r.conclusion ?? '')) state = 'skip';
    else state = 'pass';
    return url ? { name, state, url } : { name, state };
  });
}

export function ciState(checks: Check[]): CiState {
  if (checks.some((c) => c.state === 'fail')) return 'fail';
  if (checks.some((c) => c.state === 'running')) return 'running';
  if (checks.some((c) => c.state === 'pass')) return 'pass';
  return 'none';
}

// ── 화면 배치 ──

/** 목록(340) + 상세가 읽히는 최소 폭(560). 이보다 좁으면 한 칸씩 — 채팅 패널을 연 리뷰(≈860px)에서 상세가 패널 밑으로 잘리던 것(2026-10-06) */
export const REVIEW_SPLIT_MIN = 900;
export type ReviewPanes = 'split' | 'list' | 'detail';

/** 창 폭이 아니라 리뷰 칸이 실제로 받은 폭으로. 0 = 아직 못 잼 → 나란히 */
export const reviewPanes = (width: number, detailOpen: boolean): ReviewPanes =>
  width === 0 || width >= REVIEW_SPLIT_MIN ? 'split' : detailOpen ? 'detail' : 'list';

/** 경로 → 폴더(줄여도 되는 쪽)·파일 이름(지킬 쪽) */
export function splitPath(path: string): { dir: string; name: string } {
  const i = path.lastIndexOf('/');
  return { dir: path.slice(0, i + 1), name: path.slice(i + 1) };
}
