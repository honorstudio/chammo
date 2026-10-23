// claude 데몬이 앱과 다른 데이터 폴더(CHAMMO_HOME)로 떠 있으면 맨 앞 참모에게 한 줄 — 판단은 Rust daemon_env(ps eww).
// 세션은 부른 쪽이 아니라 데몬 env 를 받아서, 시험이 띄운 데몬이면 설정 고정이 없는 세션이 시험 폴더를 썼다(2026-10-23 아이맥 soak)
import { tr } from '../i18n';

export type DaemonEnv = { pid: number; home: string };

/** 데몬·값마다 한 번 — 데몬이 다시 뜨면(번호가 바뀜) 또 알린다 */
export const daemonEnvKey = (d: DaemonEnv) => `${d.pid}:${d.home}`;

/** 참모 입력칸 한 줄(Enter 로 보내져서 줄바꿈 없이) */
export function daemonEnvText(d: DaemonEnv): string {
  return tr(`[앱] claude 데몬(pid ${d.pid})이 다른 데이터 폴더 CHAMMO_HOME=${d.home} 로 떠 있어 — 시험이 데몬을 띄운 것 같아. 세션은 데몬 env 를 물려받아서 설정 고정이 없는 세션은 그 폴더(브라우저 프로필·카드·예약 기록)를 쓸 수 있어. 돌던 시험이 끝났으면 claude daemon stop --any --keep-workers 로 내려 줘 — 도는 세션은 그대로 두고, 데몬은 앱이 앱 환경으로 다시 띄워`,
    `[app] The claude daemon (pid ${d.pid}) is running with a different data folder CHAMMO_HOME=${d.home} — a test probably started it. Sessions inherit the daemon's env, so sessions without a pinned setting may use that folder (browser profiles, cards, routine records). Once that test is done, stop it with claude daemon stop --any --keep-workers — running sessions stay, and the app starts the daemon again with its own env`);
}
