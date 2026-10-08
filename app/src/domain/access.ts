// 프로젝트 폴더 읽기·같은 앱 여러 벌 — 판단만(Rust access.rs·copies.rs 가 읽고, 화면은 App·Setup).
// 앱을 새로 깔거나 이름을 바꾸면 맥 권한(데스크탑·전체 디스크 접근)이 풀려 세션이 'Unexpected' 로만 실패했다(2026-10-06 이슈 #1)

export type AccessState = 'ok' | 'denied' | 'noPerm' | 'missing' | 'pending' | 'error';
export type Access = { state: AccessState; dir: string; protected: boolean; detail: string };

/** 시스템 설정 → 개인정보 보호 및 보안 → 전체 디스크 접근 권한 */
export const FULL_DISK_URL = 'x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles';

/** 앱 띠 — 막혔을 때만. mac = 맥 개인정보 보호가 막음(설정 열기), perm = 파일 권한. 닫은 폴더(dismissed)는 다시 안 띄운다 */
export function accessBanner(a: Access | null, dismissed?: string | null): { kind: 'mac' | 'perm'; dir: string } | null {
  if (!a || (a.state !== 'denied' && a.state !== 'noPerm') || a.dir === dismissed) return null;
  return { kind: a.state === 'denied' ? 'mac' : 'perm', dir: a.dir };
}

/** 마법사 기본 설정 — 막혔거나 맥 권한 창 답을 기다리면 다음으로 못 간다. 아직 없는 폴더는 시작하기에서 만든다 */
export function wizardAccess(a: Access | null): { block: boolean; kind: 'mac' | 'perm' | 'pending' | null } {
  if (!a) return { block: false, kind: null };
  if (a.state === 'denied') return { block: true, kind: 'mac' };
  if (a.state === 'noPerm') return { block: true, kind: 'perm' };
  if (a.state === 'pending') return { block: true, kind: 'pending' };
  return { block: false, kind: null };
}

export type AppCopy = { path: string; version: string; pid: number | null };
export type Copies = { running: AppCopy[]; installed: AppCopy[]; fromDmg: boolean };

const label = (c: AppCopy) => (c.version ? `${c.path} (${c.version})` : c.path);

/** 같은 앱 여러 벌 알림 — 알리기만 한다(끄기·지우기는 사람). key 로 닫으면 같은 상태엔 다시 안 뜬다 */
export function copiesNote(c: Copies | null, dismissed?: string | null): { key: string; running: string[]; installed: string[]; fromDmg: boolean } | null {
  if (!c || (!c.running.length && !c.installed.length && !c.fromDmg)) return null;
  const key = [...c.running.map((r) => `${r.path}#${r.pid}`), ...c.installed.map((i) => i.path), c.fromDmg ? 'dmg' : ''].join('|');
  if (key === dismissed) return null;
  return { key, running: c.running.map(label), installed: c.installed.map(label), fromDmg: c.fromDmg };
}
