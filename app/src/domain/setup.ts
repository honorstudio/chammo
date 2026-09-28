// 환경 점검 판단 — Claude Code 버전이 확인된 범위인가, 설정을 끝내도 되나
// Chammo 는 Claude Code 의 백그라운드 세션 기능(--bg·agents --json·attach)에 기댄다. 확인한 범위는 2.1.280 이상의 2.1.x

export type EnvCheck = {
  claudePath: string | null;
  claudeVersion: string;
  loggedIn: boolean;
  clt: boolean;
  ghPath: string | null;
  ghUser: string | null;
};

/** "2.1.283 (Claude Code)" → [2, 1, 283]. 모양이 다르면 null */
export function parseClaudeVersion(text: string): [number, number, number] | null {
  const m = /(\d+)\.(\d+)\.(\d+)/.exec(text);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

export const MIN_PATCH = 280;

/** ok = 확인된 범위, old = 더 옛것(업데이트 필요), new = 더 새것(아마 되지만 확인 전), unknown = 못 읽음 */
export type VersionFit = 'ok' | 'old' | 'new' | 'unknown';

export function versionFit(text: string): VersionFit {
  const v = parseClaudeVersion(text);
  if (!v) return 'unknown';
  const [major, minor, patch] = v;
  if (major < 2 || (major === 2 && minor < 1) || (major === 2 && minor === 1 && patch < MIN_PATCH)) return 'old';
  if (major === 2 && minor === 1) return 'ok';
  return 'new';
}

/** 경고 배너를 띄울까 — 버전을 못 읽었거나(claude 가 없을 땐 설정 화면이 따로 안내) 이 버전을 이미 닫았으면 안 띄운다 */
export function versionWarning(text: string, dismissed: string | null): VersionFit | null {
  const fit = versionFit(text);
  if (fit === 'ok' || fit === 'unknown') return null;
  return dismissed === text.trim() ? null : fit;
}

/** 설정을 끝낼 수 있나 — Claude Code 설치·로그인·확인된 버전 이상, 명령줄 도구(git)는 꼭. gh 는 선택 */
export const setupReady = (c: EnvCheck | null): boolean => !!c && !!c.claudePath && c.loggedIn && c.clt && versionFit(c.claudeVersion) !== 'old';

/** 셸 작은따옴표로 감싸기 — 경로·안내 문장을 명령에 그대로 넣으려고 */
export const shq = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

export type SetupTask = 'install' | 'update' | 'login' | 'clt' | 'ghLogin' | 'trust';

/**
 * 설정 화면의 터미널에서 돌릴 한 번짜리 명령. 끝나면 무엇을 하면 되는지 한 줄 찍는다(done).
 * claude·gh 는 찾은 절대 경로로(앱의 PATH 에 없을 수 있어서)
 */
export function setupCommand(task: SetupTask, bins: { claude?: string | null; gh?: string | null }, done: string, dir?: string): string {
  const tail = `; echo; echo ${shq(done)}`;
  switch (task) {
    case 'install':
      return `curl -fsSL https://claude.ai/install.sh | bash${tail}`;
    case 'update': {
      // 앱이 쓰는 그 claude 의 실제 자리로 가른다 — brew(cask) 것이면 brew upgrade, 아니면(공식 설치·npm) claude update.
      // "brew 에 하나 있나"로 가르면 공식 설치본을 두고 brew 것만 올린다(아이맥 실측: 공식 2.1.263 + brew 2.1.267)
      const c = shq(bins.claude || 'claude');
      return `R=$(readlink -f ${c} 2>/dev/null || echo ${c}); case "$R" in */Caskroom/*) B=$(command -v brew || ls /opt/homebrew/bin/brew /usr/local/bin/brew 2>/dev/null | head -1); "$B" upgrade --cask claude-code ;; *) ${c} update ;; esac${tail}`;
    }
    case 'login':
      return `${shq(bins.claude || 'claude')} auth login${tail}`;
    case 'clt':
      return `xcode-select --install${tail}`;
    case 'ghLogin':
      return `${shq(bins.gh || 'gh')} auth login${tail}`;
    case 'trust':
      // 폴더 믿기 — 그 폴더에서 claude 를 대화형으로 켠다. 뜨는 질문에 Enter(예) → 기록되면 앱이 창을 닫는다(claude 도 같이 꺼진다)
      return `cd ${shq(dir ?? '.')} && exec ${shq(bins.claude || 'claude')}`;
  }
}

/** 첫 실행 마법사 — 한 화면에 한 단계(사용자 2026-09-28 "설정 마법사같은 거"). 설정 메뉴로 열면 한 페이지 그대로 */
export type WizardStep = 'welcome' | 'check' | 'basics' | 'features' | 'ready';
export const WIZARD: WizardStep[] = ['welcome', 'check', 'basics', 'features', 'ready'];
/** 폴더 믿음 — 프로젝트 폴더·HQ (Claude Code 가 새 폴더에선 믿기 전에 세션을 안 띄운다) */
export type Trust = { dev: boolean; hq: boolean };
/** 다음으로 넘어갈 수 있나 — 점검 단계는 Claude Code 설치·로그인·명령줄 도구가, 기본 설정 단계는 두 폴더 믿기가 다 돼야.
 *  마지막 단계는 '시작하기'라 다음이 없다 */
export function canNext(step: WizardStep, check: EnvCheck | null, trust?: Trust): boolean {
  if (step === 'check') return setupReady(check);
  if (step === 'basics') return !!trust?.dev && !!trust?.hq;
  return step !== 'ready';
}

/** 폴더 고르기 창이 준 절대 경로를 입력칸 모양으로 — 홈 안이면 ~/… (설정 파일에도 이렇게 저장된다) */
export function tildify(path: string, home: string): string {
  const p = path.length > 1 ? path.replace(/\/+$/, '') : path;
  const h = home.replace(/\/+$/, '');
  if (!h) return p;
  if (p === h) return '~';
  return p.startsWith(h + '/') ? '~' + p.slice(h.length) : p;
}

/** macOS 알림 권한 — Rust notify_status 가 준다 */
export type NotifyStatus = 'granted' | 'denied' | 'notDetermined' | 'unavailable';

/** 마법사 기능 단계의 알림 줄. 거부는 앱이 다시 물을 수 없어서 시스템 설정으로 보낸다. 막지는 않는다(알림 없이도 앱은 돈다) */
export function notifyRow(s: NotifyStatus): { state: 'ok' | 'need' | 'opt'; action: 'request' | 'settings' | null } {
  if (s === 'granted') return { state: 'ok', action: null };
  if (s === 'notDetermined') return { state: 'need', action: 'request' };
  if (s === 'denied') return { state: 'need', action: 'settings' };
  return { state: 'opt', action: null };
}

/** Rust browser_status */
export type BrowserStatus = { node: string | null; nodeVersion: string; nodeOk: boolean; installed: boolean; chrome: boolean };

/** 브라우저 자동화 줄 — 막지 않는 선택 기능. Node 20+ 가 있으면 설치 버튼, 없으면 Node 받기 안내 */
export function browserRow(s: BrowserStatus | null): { state: 'ok' | 'opt'; action: 'install' | 'getNode' | null } {
  if (!s) return { state: 'opt', action: null };
  if (s.installed) return { state: 'ok', action: null };
  return { state: 'opt', action: s.nodeOk ? 'install' : 'getNode' };
}

/**
 * 프로젝트 폴더(devRoot) 밖 폴더를 프로젝트로 하나 추가 — 옮길 수 없는 폴더(아이맥 ~/automation/… 등, 2026-09-28 사용자).
 * picked = 폴더 고르기 창이 준 절대 경로. 결과 목록은 `~/…` 모양. note: dup 이미 있음 · inside 프로젝트 폴더 안이라 이미 보임 · root 프로젝트 폴더 자체·홈 전체
 */
export function addExtraProject(list: string[], picked: string, devRoot: string, home: string): { list: string[]; note?: 'dup' | 'inside' | 'root' } {
  const p = tildify(picked, home);
  const root = tildify(devRoot.replace(/^~(?=\/|$)/, home), home);
  if (p === '~' || p === '/' || p === root) return { list, note: 'root' };
  if (p.startsWith(root + '/')) return { list, note: 'inside' };
  if (list.some((x) => tildify(x.replace(/^~(?=\/|$)/, home), home) === p)) return { list, note: 'dup' };
  return { list: [...list, p] };
}
