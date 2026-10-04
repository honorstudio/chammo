// 재시작으로 꺼진 세션 — 사람에게 카드를 안 띄우고 참모가 처리한다(2026-10-04 사용자 "사용자가 이거 못 알아볼 것 같다, 어떻게 쓰는지 아예 모를 것 같다").
// 끝난 세션은 조용히 꺼진 목록에서 뺀다(대화 기록은 그대로 — claude rm 안 함, 오케스트레이터 홈에서 되살릴 수 있다).
// 안 끝난 세션은 주인 참모에게 한 번 알린다 → 참모가 판단해서 claude respawn. 참모가 하나도 없을 때만 사람에게 짧게 보인다.
// 보고까지 끝낸 세션도, rm 된 세션도 사람에게 물을 필요가 없었다
import { tr } from '../i18n';
import type { Activity } from './activity';
import { forwardTo } from './forwardQuestion';
import type { LiveSnap, SnapSession } from './revive';
import { fwd } from './paths';
import { classifyWorkspace, orchestratorLike, type Session } from './session';
import type { TaskEvent } from './tasks';

/** agents --all 에 있나: true 있음(살아 있거나 꺼진 채 남음) · false 없음(claude rm) · undefined 목록을 못 믿음 */
export type Listed = boolean | undefined;

const SHORT = /^[0-9a-f]{8}$/;

/** 이름으로만 보낸 일은 이 세션이 뜬 뒤 것만 — 이름이 같은 옛 세션 기록이 섞이지 않게. 첫 지시는 띄우기 직전에 적히기도 해서 여유를 둔다 */
const NAME_SLACK = 10 * 60_000;

/** 이 세션에 보낸 일 — 짧은 번호·대화 id·"이름 [번호 앞자리]"는 언제든, 이름만이면 이 세션이 뜬 뒤(inbox.findTarget 과 같은 꼴) */
export function sendsTo(s: SnapSession, events: TaskEvent[]): TaskEvent[] {
  return events.filter((e) => {
    const t = e.target;
    if (e.type !== 'send' || !t) return false;
    if (t === s.id || t === s.sessionId) return true;
    const m = t.match(/^(.+?) \[([0-9a-f]{4,})\]$/);
    if (m) return s.sessionId.startsWith(m[2]!) || !!s.id?.startsWith(m[2]!);
    return t === s.name && (!s.startedAt || Date.parse(e.ts) >= s.startedAt - NAME_SLACK);
  });
}

/** 보고처럼 끝났지만 무언가를 기다리던 말 — 그 기다림(CI 감시·백그라운드 작업)은 재시작으로 죽었다(2026-10-04 리뷰: "CI 를 기다리는 중이야. 끝나면 결과를 붙여…") */
const WAITING = /기다리는 중|기다리고 있|기다릴게|끝나면|끝나는 대로|대기 중|돌아가는 중|도는 중|진행 중이|\bwaiting\b|\bonce (?:it|the)\b.*\b(?:finish|done|complete)/i;

/**
 * 끝났나. 애매하면 '안 끝남'(open) — 빼 버리면 사람도 참모도 모르게 일이 사라진다.
 * 끝 = claude rm 돼서 목록에 없음, 또는 꺼질 때 일하는 중이 아니었고 + 마지막 턴이 끝나 있고(중간에 끊기지 않음·새 지시 없음·한도로 안 멈춤)
 *       + (맡긴 일이 다 done 이거나 마지막 답이 묻는 말이 아님 = 보고로 끝맺음)
 * 대화 기록을 못 읽었으면 꺼질 때 쉬고 있던 게 확실하고(busy false) 맡긴 일이 다 done 일 때만 끝
 */
export function lostVerdict(s: SnapSession, o: { events: TaskEvent[]; activity?: Activity; listed: Listed }): 'finished' | 'open' {
  if (o.listed === false) return 'finished';
  if (s.busy) return 'open';
  const sends = sendsTo(s, o.events);
  const closed = new Set(o.events.filter((e) => e.type === 'done').map((e) => e.task));
  const allDone = sends.length > 0 && sends.every((e) => closed.has(e.task));
  const a = o.activity;
  if (!a) return s.busy === false && allDone ? 'finished' : 'open';
  const r = a.reply;
  // 턴이 끝나 있나 — 답이 턴 끝이고, 그 뒤로 새 지시·도구 줄·쌓인 입력이 없고, 한도로 안 멈췄다
  const turnDone = !!r?.turnEnd && !r.midTurn && !(a.prompt && a.prompt.ts > r.ts) && !(a.lastAt && a.lastAt > r.ts) && !a.limit;
  if (!turnDone) return 'open';
  if (allDone) return 'finished';
  return !r!.asks && !WAITING.test(`${r!.text} ${r!.tail ?? ''}`) ? 'finished' : 'open';
}

/**
 * 꺼진 목록 가르기 — drop: 조용히 뺄 것, open: 주인 참모에게 알릴 것.
 * 꺼진 참모는 이 길에서 뺀다(참모는 사람이 오케스트레이터 홈에서 고른다, 2026-10-03). 단 자동으로 다시 켜기를 켠 무인 맥이면 남긴다(revive autoRestore 몫)
 */
export function triageLost(
  lost: SnapSession[],
  o: { events: TaskEvent[]; activity: Record<string, Activity | undefined>; listed: (s: SnapSession) => Listed; isOrch: (s: SnapSession) => boolean; autoRevive: boolean },
): { drop: SnapSession[]; open: SnapSession[] } {
  const drop: SnapSession[] = [];
  const open: SnapSession[] = [];
  for (const s of lost) {
    if (o.isOrch(s)) {
      if (!o.autoRevive) drop.push(s);
      continue;
    }
    if (lostVerdict(s, { events: o.events, activity: o.activity[s.sessionId], listed: o.listed(s) }) === 'finished') drop.push(s);
    else open.push(s);
  }
  return { drop, open };
}

/** 꺼진 참모인가 — HQ 폴더의 비서 이름 꼴(이름 없는 것 포함). 윈도우 경로는 빗금·대소문자를 맞춰 본다(stopped.stoppedOrchs 와 같은 꼴) */
export function isHqOrch(s: SnapSession, hqDir: string): boolean {
  const norm = (p: string) => fwd(p).replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
  return !!hqDir && norm(s.cwd) === norm(hqDir) && (!s.name || orchestratorLike(s.name));
}

/** 꺼진 세션을 세션 모양으로 — 주인 찾기(forwardTo·roleHeir)가 살아 있는 세션처럼 다루게 */
export function lostAsSession(s: SnapSession, devRoot: string, extras: string[] = []): Session {
  return { id: s.id ?? s.sessionId, name: s.name, cwd: s.cwd, kind: 'background', state: 'idle', startedAt: 0, sessionId: s.sessionId, ...classifyWorkspace(s.cwd, devRoot, extras) };
}

/**
 * 안 끝난 꺼진 세션을 받을 참모 — 멈춤 알림과 같은 길(forwardTo): 마지막으로 일을 보낸 참모 → 같은 프로젝트를 맡긴 참모 → 맡은 일(heir) → 맨 앞 참모.
 * 같은 참모에게 갈 것은 한 번에 묶는다. 참모가 하나도 없으면 hold(사람에게 짧게). 받을 참모가 확인창에 걸려 있으면 이번엔 건너뛴다(다음 폴링에)
 */
export function planNotices(
  open: SnapSession[],
  o: { events: TaskEvent[]; orchs: Session[]; sessions: Session[]; front?: Session; heir?: (s: Session) => Session | undefined; devRoot: string; extras?: string[] },
): { notices: { to: Session; sessions: SnapSession[] }[]; hold: SnapSession[] } {
  const notices: { to: Session; sessions: SnapSession[] }[] = [];
  const hold: SnapSession[] = [];
  for (const s of open) {
    const sub = lostAsSession(s, o.devRoot, o.extras);
    const to = o.orchs.length ? forwardTo(sub, o.events, o.orchs, [sub, ...o.sessions], o.front, o.heir) : undefined;
    if (!to) { hold.push(s); continue; }
    if (to.state === 'blocked') continue;
    const n = notices.find((x) => x.to.id === to.id);
    if (n) n.sessions.push(s);
    else notices.push({ to, sessions: [s] });
  }
  return { notices, hold };
}

const flat = (t: string) => t.replace(/\s+/g, ' ').trim();
const cut = (t: string, n: number) => ([...t].length > n ? [...t].slice(0, n).join('') + '…' : t);

/** 하던 일 한 줄 — 마지막으로 시킨 일 제목, 없으면 마지막 지시(대화 기록) */
export function lastDoing(s: SnapSession, events: TaskEvent[], activity?: Activity): string | undefined {
  const sent = sendsTo(s, events).filter((e) => e.title).at(-1)?.title;
  const t = sent ?? activity?.prompt?.text;
  return t ? cut(flat(t), 60) || undefined : undefined;
}

const nameOf = (s: SnapSession) => s.name || s.cwd.split('/').filter(Boolean).pop() || s.sessionId.slice(0, 8);
const hasShort = (s: SnapSession) => !!s.id && SHORT.test(s.id);
const resumeCmd = (s: SnapSession) => (hasShort(s) ? `claude respawn ${s.id}` : `cd "${s.cwd}" && claude --bg --dangerously-skip-permissions --resume ${s.sessionId}`);

/** 참모 입력칸에 넣을 한 줄(Enter 로 보내져서 줄바꿈 없이) */
export function restartNotice(items: { s: SnapSession; doing?: string }[]): string {
  const item = ({ s, doing }: { s: SnapSession; doing?: string }, cmd: boolean) =>
    `${nameOf(s)}(${hasShort(s) ? s.id : s.sessionId.slice(0, 8)})${doing ? tr(` — 하던 일 ${doing}`, ` — was doing ${doing}`) : ''}${cmd ? ` [${resumeCmd(s)}]` : ''}`;
  if (items.length === 1) {
    const one = items[0]!;
    return tr(
      `[앱] 재시작으로 꺼진 세션: ${item(one, false)}. 이어서 켜려면 ${resumeCmd(one.s)}, 끝난 거면 그냥 둬`,
      `[app] Session stopped by a restart: ${item(one, false)}. To resume: ${resumeCmd(one.s)}; if it was finished, leave it`,
    );
  }
  const list = items.map((x) => item(x, !hasShort(x.s))).join(' · ');
  return tr(
    `[앱] 재시작으로 꺼진 세션 ${items.length}개: ${list}. 이어서 켜려면 claude respawn <짧은 번호>, 끝난 거면 그냥 둬`,
    `[app] ${items.length} sessions stopped by a restart: ${list}. To resume: claude respawn <short id>; if one was finished, leave it`,
  );
}

/** 꺼진 목록에서 뺀다 — 끝나서 뺄 때도, 참모에게 알렸을 때도(같은 알림 두 번 안 가게 기록부터 지운다) */
export function forgetLost(snap: LiveSnap, sessionIds: string[]): LiveSnap {
  const out = new Set(sessionIds);
  return { ...snap, lost: snap.lost.filter((x) => !out.has(x.sessionId)) };
}
