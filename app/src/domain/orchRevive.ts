// 참모 세션이 앱이 끄지 않았는데 목록에서 사라지면 같은 대화로 다시 켠다(claude respawn — App resumeSession).
// 사람이 끈 것(앱 버튼·폰·지우기, 터미널·스크립트의 claude stop)은 안 켠다. /exit 로 나간 것은 아직 켠다(roadmap 부채)
// 참모가 조용히 꺼지면 사람은 껐다 켤 줄 모른다(2026-10-21).
// 관리 프로그램(daemon) 재시작으로 꺼진 건 재시작 복구(domain/lostTriage) 몫이라 여기선 안 건드린다. 하위 세션은 참모가 판단한다(그대로).
// 연달아 죽으면(TRY_WINDOW 안에 MAX_TRIES 번) 멈추고 결정 대기함 카드 한 번 — 끝없이 켜다 죽기를 되풀이하지 않게
import { tr } from '../i18n';
import { seenName } from './session';

export type ReviveOrch = { id: string; sessionId: string; name: string; cwd: string };
type Seen = { s: ReviveOrch; daemon: number | null };
export type ReviveMemo = {
  seen: Record<string, Seen>;
  goneAt: Record<string, number>;
  tries: Record<string, number[]>;
  lastTry: Record<string, number>;
  /** 멈추고 띄운 카드가 열려 있다 — 다시 뜨면 닫는다 */
  gaveUp: Record<string, number>;
  /** 마지막으로 카드를 띄운 때 — TRY_WINDOW 안엔 한 장만(사람이 켰다 또 죽어도 카드가 쌓이지 않게) */
  cardAt: Record<string, number>;
};
export const emptyRevive: ReviveMemo = { seen: {}, goneAt: {}, tries: {}, lastTry: {}, gaveUp: {}, cardAt: {} };

/** 사라진 채 이만큼은 기다린다 — 다른 참모의 respawn 은 같은 초에 다시 뜬다(daemon.log settled → claimed-spare) */
export const GONE_GRACE = 10_000;
/** 다시 켰는데 안 뜨면 이만큼 뒤에 또 */
export const RETRY_GAP = 30_000;
/** 맥이 바쁠 때(domain/busyGate) 사라진 참모를 기다리는 시간·다시 켜기 사이 — Claude Code 가 '응답 없음'으로 다시 켜는 동안(5~12초 + 대화 다시 읽기) 앱이 또 켜서 겹쳤다(2026-10-26 부팅 직후) */
export const BUSY_GONE_GRACE = 60_000;
export const MAX_TRIES = 3;
export const TRY_WINDOW = 10 * 60_000;

export function planRevive(m: ReviveMemo, o: {
  live: ReviveOrch[];
  now: number;
  /** 관리 프로그램 시작 시각(daemonStartedAt). null 이면 못 읽음 — 판단을 미룬다 */
  daemon: number | null;
  /** 앱이 방금 끈·지운 세션(Rust stop_blocking·remove_blocking) — 사람이 끈 것 */
  stoppedByApp: (id: string) => boolean;
  /** 앱 밖(터미널·스크립트)에서 claude stop 으로 끈 세션(daemon.log settled killed) — 이것도 사람이 끈 것(#6) */
  stoppedOutside: (id: string) => boolean;
  /** 묶음과 상관없이 agents 목록에 살아 있나 — /rename 으로 참모 같지 않은 이름이 되어 도우미 칸으로 옮겨 간 세션은 산 것(0.3.6 리뷰) */
  alive: (id: string) => boolean;
  /** 맥이 바쁨 — 기다림·다시 켜기 사이를 BUSY_GONE_GRACE 로 */
  busy?: boolean;
}): { memo: ReviveMemo; revive: ReviveOrch[]; giveUp: ReviveOrch[]; closed: ReviveOrch[] } {
  const seen = { ...m.seen }, goneAt = { ...m.goneAt }, tries = { ...m.tries }, lastTry = { ...m.lastTry }, gaveUp = { ...m.gaveUp }, cardAt = { ...m.cardAt };
  const revive: ReviveOrch[] = [], giveUp: ReviveOrch[] = [], closed: ReviveOrch[] = [];
  const forget = (id: string) => { delete seen[id]; delete goneAt[id]; delete tries[id]; delete lastTry[id]; delete gaveUp[id]; delete cardAt[id]; };
  const liveIds = new Set(o.live.map((s) => s.id));
  for (const s of o.live) {
    seen[s.id] = { s, daemon: o.daemon ?? seen[s.id]?.daemon ?? null };
    delete goneAt[s.id];
    delete lastTry[s.id];
    if (gaveUp[s.id] != null) { closed.push(s); delete gaveUp[s.id]; }
  }
  for (const [id, { s, daemon }] of Object.entries(seen)) {
    if (liveIds.has(id)) continue;
    // 참모 묶음에서만 빠지고 살아 있다 — 이제 참모가 아니니 잊는다(멈춤 카드가 열려 있으면 닫는다). 참모 이름으로 돌아오면 다시 본다
    if (o.alive(id)) { if (gaveUp[id] != null) closed.push(s); forget(id); continue; }
    const gone = (goneAt[id] ??= o.now);
    if (o.stoppedByApp(id) || o.stoppedOutside(id)) { forget(id); continue; }
    if (o.daemon == null) continue;
    if (daemon != null && daemon !== o.daemon) { forget(id); continue; }
    if (o.now - gone < (o.busy ? BUSY_GONE_GRACE : GONE_GRACE)) continue;
    if (lastTry[id] != null && o.now - lastTry[id]! < (o.busy ? BUSY_GONE_GRACE : RETRY_GAP)) continue;
    const recent = (tries[id] ?? []).filter((t) => o.now - t < TRY_WINDOW);
    tries[id] = recent;
    if (recent.length >= MAX_TRIES) {
      if (gaveUp[id] == null && !(cardAt[id] != null && o.now - cardAt[id]! < TRY_WINDOW)) { gaveUp[id] = o.now; cardAt[id] = o.now; giveUp.push(s); }
      continue;
    }
    tries[id] = [...recent, o.now];
    lastTry[id] = o.now;
    revive.push(s);
  }
  return { memo: { seen, goneAt, tries, lastTry, gaveUp, cardAt }, revive, giveUp, closed };
}

const who = (s: ReviveOrch) => (s.name && seenName(s.name)) || s.id;

/** 멈췄을 때 결정 대기함 카드 — 작업 기록 send + ask(domain/inbox 가 마지막이 ask 인 일을 카드로). 다시 뜨면 done 으로 닫는다 */
export function reviveCard(s: ReviveOrch, ts: string, task: string): [Record<string, unknown>, Record<string, unknown>] {
  const name = who(s);
  return [
    { ts, type: 'send', task, target: s.name, title: tr(`${name} 자동으로 다시 켜기`, `Auto-restart ${name}`) },
    { ts, type: 'ask', task, note: tr(
      `${name} — 10분 안에 ${MAX_TRIES}번 꺼져서 자동으로 다시 켜기를 멈췄어. 홈에서 다시 켜 줘 — 또 꺼지면 이 맥의 Claude Code 상태(로그인·업데이트)를 봐야 해`, // 이름이 '참모'면 '참모 참모가'로 겹쳤다(10/21 시험 앱)
      `${name} stopped ${MAX_TRIES} times within 10 minutes, so auto-restart is paused. Wake it from Home — if it keeps stopping, check Claude Code on this Mac (sign-in, updates)`,
    ) },
  ];
}
