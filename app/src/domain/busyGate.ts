// 맥이 바쁠 때(부팅 직후·1분 부하가 코어의 두 배 넘음) 세션 붙이기를 줄 세운다.
// 2026-10-26 23:50 강제 재부팅 뒤 부하 35→70: 앱이 참모 칸들을 한꺼번에 attach 하고(칸마다 claude 프로세스 하나), 끊긴 칸은 2.5초마다
// claude agents 를 새로 띄웠다. 화면을 12초 안에 못 그린 참모를 Claude Code 데몬이 '응답 없음'으로 두 번 죽였다 켰고(daemon.log
// 23:53:29·43 settled killed → claimed-spare respawn), 그 사이 친 채팅 말은 '전달 안 됨'이 됐다. 한가할 땐 예전 그대로다
import { josa, tr } from '../i18n';
import { REATTACH_POLL, type AttachPhase, type LinkState } from './attachExit';

export type Busy = 'ok' | 'busy' | 'boot';
/** 부팅 뒤 이만큼은 부하가 코어 수만 넘어도 바쁜 걸로 — 1분 부하는 늦게 올라 켜자마자는 낮게 보인다(로그인 항목·Spotlight·세션들이 한꺼번에 뜬다) */
export const BOOT_GRACE = 5 * 60_000;
/** 1분 부하가 코어 수의 이 배를 넘으면 바쁨 — 이날 35·70(코어 10). 부하 화면 '높음'보다 높게 잡아 평소 빌드 정도로는 안 걸린다 */
export const BUSY_RATIO = 2;
/** 바쁠 때 끊긴 칸이 목록을 다시 보는 간격 */
export const BUSY_POLL = 10_000;
/** 차례 하나를 쥐는 최대 — 화면이 끝내 안 와도 다음 칸이 굳지 않게(데몬의 '응답 없음'은 5~12초) */
export const TURN_MAX = 25_000;

export function busyOf(s: { load1: number; cores: number; bootAt?: number | null } | null, now: number): Busy {
  if (!s) return 'ok';
  // 부팅 직후엔 코어 수만 넘어도 — 조용히 재부팅한 맥(부하 1~2)은 예전 그대로
  if (s.bootAt != null && now >= s.bootAt && now - s.bootAt < BOOT_GRACE && s.load1 >= s.cores) return 'boot';
  return s.load1 >= s.cores * BUSY_RATIO ? 'busy' : 'ok';
}

export const reattachEvery = (b: Busy) => (b === 'ok' ? REATTACH_POLL : BUSY_POLL);

/** attach 차례 — 한가하면 다 바로, 바쁘면 앞 칸이 화면을 받거나(놓기) TURN_MAX 가 지나야 다음 칸. take 가 주는 함수로 놓는다(두 번 불러도 한 번) */
export function attachTurns(busy: () => Busy, max = TURN_MAX) {
  let inflight = 0;
  const queue: ((release: () => void) => void)[] = [];
  const free = () => busy() === 'ok' || inflight === 0;
  const grant = (go: (release: () => void) => void) => {
    inflight++;
    let done = false;
    const release = () => {
      if (done) return;
      done = true;
      clearTimeout(t);
      inflight--;
      pump();
    };
    const t = setTimeout(release, max);
    go(release);
  };
  const pump = () => { while (queue.length && free()) grant(queue.shift()!); };
  return {
    take(signal?: AbortSignal): Promise<() => void> {
      if (signal?.aborted) return Promise.reject(new Error('attach cancelled'));
      if (!queue.length && free()) return new Promise((res) => grant(res));
      return new Promise((res, rej) => {
        queue.push(res);
        signal?.addEventListener('abort', () => {
          const i = queue.indexOf(res);
          if (i < 0) return;
          queue.splice(i, 1);
          rej(new Error('attach cancelled'));
        }, { once: true });
      });
    },
    /** 부하가 바뀌었을 때 — 한가해졌으면 기다리던 칸을 다 푼다 */
    poke: () => pump(),
    waiting: () => queue.length,
  };
}

/** 붙는 중 안내를 미루는 시간 — 한가한 맥에서 0.3초면 붙는데 그때마다 안내·채팅 덮개가 깜빡였다 */
export const SLOW_LINK_MS = 1500;

/** 붙는 중이 SLOW_LINK_MS 를 넘긴 칸 + 다음에 볼 때까지 남은 ms(없으면 null). since = 칸마다 붙는 중이 된 시각(여기서 고친다) —
 *  다른 칸이 바뀌어도 시계가 처음부터 다시 돌지 않게(10-27 리뷰: 타이머 하나가 칸이 바뀔 때마다 리셋돼 안내가 영영 안 떴다) */
export function slowLinks(link: Record<string, LinkState>, since: Map<string, number>, now: number): { slow: string[]; wait: number | null } {
  for (const id of [...since.keys()]) if (!link[id] || link[id] === 'live') since.delete(id);
  const slow: string[] = [];
  let wait: number | null = null;
  for (const [id, st] of Object.entries(link)) {
    if (st === 'live') continue;
    if (!since.has(id)) since.set(id, now);
    const left = since.get(id)! + SLOW_LINK_MS - now;
    if (left <= 0) slow.push(id);
    else wait = wait === null ? left : Math.min(wait, left);
  }
  return { slow, wait };
}

const busyLead = (b: Busy) => (b === 'boot' ? tr('맥이 막 켜져 바빠서 ', 'The Mac just started and is busy, so ') : b === 'busy' ? tr('맥이 바빠서 ', 'The Mac is busy, so ') : '');

/** 채팅 칸 위 한 줄 — 붙어 있으면 null. who = '참모'·'세션' */
export function linkNotice(o: { link: LinkState | undefined; phase?: AttachPhase; listUnknown?: boolean; busy: Busy; who?: string }): string | null {
  const who = o.who ?? tr('세션', 'the session');
  const then = tr('보낸 말은 붙으면 보낼게', 'your message goes once it is back');
  switch (o.link) {
    case undefined: case 'live': return null;
    case 'gone': return tr('세션이 꺼진 것 같아 — 다시 켜지면 안 간 말을 다시 보내 줘', 'The session seems to have stopped — send again once it is back');
    case 'reattaching':
      if (!o.listUnknown) return tr('세션 연결이 끊겨서 다시 붙는 중 — 보낸 말은 붙으면 바로 가', 'Lost the session link — reattaching; your message goes as soon as it is back');
      return o.busy === 'ok'
        ? tr(`Claude Code 관리 프로그램이 응답이 없어 세션 목록을 못 읽는 중 — ${then}`, `Claude Code is not answering, so the session list is unreadable — ${then}`)
        : `${busyLead(o.busy)}${tr(`세션 목록을 못 읽는 중 — ${then}`, `the session list is not coming back yet — ${then}`)}`;
    case 'attaching':
      switch (o.phase) {
        case 'restarting': return `${busyLead(o.busy)}${tr(`${josa(who, '이', '가')} 답이 없어 Claude Code 가 다시 켜는 중 — ${then}`, `${who} stopped answering and Claude Code is restarting it — ${then}`)}`;
        case 'stalled': return tr(`${josa(who, '이', '가')} 계속 멈춰서 Claude Code 가 껐어 — 다시 켜질 때까지 보낸 말은 기다려`, `${who} keeps stalling and Claude Code stopped it — your message waits until it is back`);
        case 'starting': return tr(`${josa(who, '이', '가')} 켜지는 중 — 보낸 말은 켜지면 보낼게`, `${who} is starting — your message goes once it is up`);
        case 'queued': return `${busyLead(o.busy === 'ok' ? 'busy' : o.busy)}${tr(`${josa(who, '을', '를')} 차례로 붙이는 중 — ${then}`, `attaching sessions one at a time — ${then}`)}`;
        default: return `${busyLead(o.busy)}${tr(`${who} 화면에 붙는 중 — ${then}`, `attaching to ${who} — ${then}`)}`;
      }
  }
}

/** 세션 목록 실패 띠 — null 이면 아직 안 띄운다. fails = 이어진 실패 수. 시간 초과는 한 번으론 안 띄우고, 이어지면 원문 대신 사람 말로 */
export function listErrorText(err: string, fails: number, busy: Busy): string | null {
  if (!/timed out/i.test(err)) return tr(`세션 목록 실패: ${err}`, `Could not list sessions: ${err}`);
  if (fails < 2) return null;
  return busy === 'ok'
    ? tr('Claude Code 관리 프로그램이 응답이 없어 세션 목록을 못 받는 중 — 세션은 그대로 돌고 있을 수 있어, 잠시 기다려 줘', 'Claude Code is not answering, so the session list is stuck — sessions may still be running, give it a moment')
    : `${busyLead(busy)}${tr('세션 목록을 늦게 받는 중 — 한가해지면 저절로 돌아와(세션은 그대로 돌고 있어)', 'the session list is slow — it comes back on its own (sessions keep running)')}`;
}
