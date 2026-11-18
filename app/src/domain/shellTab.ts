// 그냥 셸 탭(11-17 사용자 "iTerm 계속 열어서 쓰는 중") — 스페이스 탭 줄(세션 탭과 같은 줄)에 sh:<번호> 탭으로 연다.
// 앱을 껐다 켜면 사라진다(되살리지 않는다). 셸을 띄우고 읽는 건 TerminalPane(shell) — 세션 터미널과 같은 부품
import { tr } from '../i18n';

export const SHELL_PREFIX = 'sh:';
export const isShellKey = (k: string) => k.startsWith(SHELL_PREFIX);

export type ShellTab = { key: string; cwd: string; title: string };

/** 폴더 끝 이름(홈이면 ~) */
export function folderName(dir: string, home: string): string {
  const d = dir.replace(/[\\/]+$/, '');
  if (!d || (home && d === home.replace(/[\\/]+$/, ''))) return '~';
  return d.split(/[\\/]/).pop() || d;
}

/** 새 셸 탭 — 번호는 한 번 쓰면 다시 안 쓴다, 같은 폴더가 이미 열려 있으면 이름 뒤에 2·3 */
export function newShell(open: ShellTab[], next: number, cwd: string, home: string): ShellTab {
  const base = folderName(cwd, home);
  const same = open.filter((t) => t.title === base || t.title.startsWith(`${base} `)).length;
  return { key: `${SHELL_PREFIX}${next}`, cwd, title: same ? `${base} ${same + 1}` : base };
}

type Root = { root: string };
const under = (p: string, root: string) => p === root || p.startsWith(root.endsWith('/') ? root : `${root}/`);

/** 시작 폴더 — 지금 보는 화면의 프로젝트(세션 탭은 그 세션 폴더의 본 저장소, 파일 탭은 그 파일이 든 프로젝트, 프로젝트 홈은 그 뿌리), 없으면 devRoot.
 *  sessionCwd = 세션 탭이면 그 세션 cwd, 워크트리 세션은 워크트리 그대로(그 가지에서 일하려고 연다) */
export function shellCwd(pick: string, opt: { sessionCwd?: string; projects: Root[]; devRoot: string }): string {
  if (pick.startsWith('s:') && opt.sessionCwd) return opt.sessionCwd;
  const path = pick.startsWith('d:') ? pick.slice(2) : pick.startsWith('c:') ? pick.slice(2) : '';
  const hashP = /#p:(.+)$/.exec(pick)?.[1];
  const at = path || hashP || '';
  if (at) {
    const hit = opt.projects.filter((p) => under(at, p.root)).sort((a, b) => b.root.length - a.root.length)[0];
    if (hit) return hit.root;
  }
  return opt.devRoot;
}

/** 닫기 확인 글 — 돌던 프로그램이 있을 때만 묻는다(null = 바로 닫는다) */
export function closeAsk(prog: string | null): { title: string; body: string } | null {
  if (prog === null) return null;
  const what = prog || tr('프로그램', 'a program');
  return { title: tr('터미널 닫기', 'Close terminal'), body: tr(`지금 돌고 있어요: ${what}\n닫으면 같이 꺼져요.`, `Still running: ${what}\nClosing stops it.`) };
}

/** 탭 줄에 남은 셸 열쇠 — 이 밖의 셸은 끈다(탭이 넘쳐 밀려났거나 닫힌 것) */
export function liveShellKeys(holds: { tabs: string[] }[]): Set<string> {
  return new Set(holds.flatMap((h) => h.tabs.filter(isShellKey)));
}
