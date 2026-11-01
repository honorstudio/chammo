// 앱 자동 업데이트(ADR 0005) — '새 버전' 띠의 버튼 하나가 받기 → 설치 → 다시 켜기. 무엇이든 안 되면 지금처럼 내려받기 링크를 연다.
// 받기·서명 확인·설치·다시 켜기는 Rust(updater.rs app_update_install) — 여기는 단계 판단과 문구만

/** Rust 가 Channel 로 보내는 단계(updater.rs Step) */
export type Step = { kind: 'started'; total: number | null } | { kind: 'progress'; got: number } | { kind: 'installing' };

export type Phase =
  | { kind: 'idle' }
  | { kind: 'get'; got: number; total: number | null }
  | { kind: 'install' }
  | { kind: 'failed'; why: string }
  /** 지난번 업데이트를 시작했는데 판이 그대로 — 윈도우는 설치기가 실패해도 앱이 이미 꺼져 있었다(Rust app_update_leftover) */
  | { kind: 'leftover' };

/** 켤 때 Rust 가 준 '안 끝난 업데이트' 판 번호로 — 그사이 사람이 업데이트를 눌러 다른 단계면 덮지 않는다 */
export function afterLeftover(p: Phase, ver: string | null): Phase {
  return ver && p.kind === 'idle' ? { kind: 'leftover' } : p;
}

/** 안 끝난 업데이트 띠 문구 [한글, 영어] */
export function leftoverNote(ver: string, now: string): [string, string] {
  return [`지난번 업데이트가 끝나지 않은 것 같아요. Chammo ${ver} 으로 다시 시도할 수 있어요 (지금 ${now}).`, `The last update doesn't seem to have finished. You can try again to get Chammo ${ver} (now on ${now}).`];
}

export function nextPhase(p: Phase, s: Step): Phase {
  if (s.kind === 'installing') return { kind: 'install' };
  const cur = p.kind === 'get' ? p : { got: 0, total: null };
  if (s.kind === 'started') return { kind: 'get', got: 0, total: s.total };
  return { kind: 'get', got: cur.got + s.got, total: cur.total };
}

const KEEP: [string, string] = ['끝나면 저절로 다시 켜져요. 그동안 앱을 끄지 마세요.', 'it restarts by itself. Please keep the app open.'];

/** 받는 중·설치 중 띠 문구 [한글, 영어]. idle·failed 는 띠가 따로 쓴다 */
export function installNote(p: Phase, ver: string): [string, string] {
  if (p.kind === 'get') {
    const pct = p.total ? ` ${Math.min(100, Math.floor((p.got / p.total) * 100))}%` : '';
    return [`Chammo ${ver} 받는 중${pct} — ${KEEP[0]}`, `Downloading Chammo ${ver}${pct} — ${KEEP[1]}`];
  }
  return [`Chammo ${ver} 설치 중 — ${KEEP[0]}`, `Installing Chammo ${ver} — ${KEEP[1]}`];
}

/** 받기·설치까지 했으면 true(곧 Rust 가 앱을 다시 켠다). 안 되면 내려받기 링크를 열고 false —
 *  'off'(업데이터 없는 판: 개인 앱)는 실패 문구 없이 지금처럼 링크만 */
export async function runInstall(install: (on: (s: Step) => void) => Promise<void>, set: (p: Phase) => void, openLink: () => Promise<void>): Promise<boolean> {
  let p: Phase = { kind: 'get', got: 0, total: null };
  set(p);
  try {
    await install((s) => { p = nextPhase(p, s); set(p); });
    return true;
  } catch (e) {
    const why = e instanceof Error ? e.message : String(e);
    set(why === 'off' ? { kind: 'idle' } : { kind: 'failed', why });
    await openLink().catch(() => {});
    return false;
  }
}
