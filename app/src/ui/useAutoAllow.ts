// 도구 권한 창 자동 허용 — 사용자 방침 2026-09-27 "권한은 항상 다 준다".
// waitingFor=permission prompt 인 세션만. 화면을 읽어 Allow 줄을 이름으로 찾고(domain/autoAllow) 키를 넣은 뒤, 풀렸는지 확인해 기록한다.
// 선택지 질문(input needed)·비밀번호·2FA·결제 창은 건드리지 않는다 — 결정 대기함에 그대로 남는다
import { useEffect, useRef } from 'react';
import { listSessionsRaw, logAutoAllow, sendKeys, sessionScreen } from '../data/tauri';
import { notifyOnce } from './notifier';
import { pickAllow, retryAfter, type AllowOutcome } from '../domain/autoAllow';
import { parseAgents, type Session } from '../domain/session';
import { tr } from '../i18n';

const CHECK_MS = 4_000;    // 누른 뒤 풀렸는지 보기까지

/** 자동 허용 대상 — 선택지 질문(input needed)은 아니다 */
const AUTO = ['permission prompt', 'startup prompt'];

const whereOf = (s: Session) => (s.workspace ? `${s.project} / ${s.workspace}` : s.project);

export function useAutoAllow(sessions: Session[], devRoot: string | undefined, onLog: () => void) {
  /** 세션 id → 다시 봐도 되는 때 (domain/autoAllow retryAfter) */
  const next = useRef(new Map<string, number>());
  const busy = useRef(false);
  useEffect(() => {
    if (busy.current || !devRoot) return;
    const now = Date.now();
    const s = sessions.find((x) => x.kind === 'background' && AUTO.includes(x.waitingFor ?? '') && now >= (next.current.get(x.id) ?? 0));
    if (!s) return;
    busy.current = true;
    const done = (o: AllowOutcome) => next.current.set(s.id, Date.now() + retryAfter(o));
    done('failed'); // 도는 동안은 다시 안 잡게
    const log = (ev: object) => logAutoAllow({ ts: new Date().toISOString(), where: whereOf(s), ...ev }).then(onLog).catch(() => {});
    void (async () => {
      try {
        const pick = pickAllow(await sessionScreen(s.id));
        if ('skip' in pick) { done('skipped'); await log({ result: tr(`건너뜀 — ${pick.skip}`, `Skipped — ${pick.skip}`) }); return; }
        await sendKeys(s.id, pick.keys);
        await new Promise((r) => setTimeout(r, CHECK_MS));
        const after = parseAgents(await listSessionsRaw(), devRoot).find((x) => x.id === s.id);
        const ok = !after || !AUTO.includes(after.waitingFor ?? '');
        done(ok ? 'allowed' : 'stillOpen');
        await log({ option: pick.option, result: ok ? tr('허용됨', 'Allowed') : tr('풀리지 않음 — 직접 봐줘', 'Still open — please check it') });
        if (!ok) notifyOnce({ kind: 'allowFail', session: s.id, orch: false, title: tr(`${whereOf(s)} 권한 창 자동 허용 실패`, `${whereOf(s)}: auto-allow failed`), body: tr(`"${pick.option}" 을 눌렀는데 창이 그대로야 — 열어서 봐줘`, `Pressed "${pick.option}" but the prompt is still there — open it and check`) });
      } catch (e: unknown) {
        done('failed');
        await log({ result: tr(`실패 — ${String(e)}`, `Failed — ${String(e)}`) });
      } finally {
        busy.current = false;
      }
    })();
  }, [sessions, devRoot, onLog]);
}
