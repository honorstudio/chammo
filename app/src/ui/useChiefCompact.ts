// 참모·프로젝트 세션 자동 정리 — 판단은 domain/chiefCompact(프로젝트는 domain/projectCompact 를 더해).
// 참모: 40%·handoff.md / 프로젝트: 50%·그 폴더 docs/starter.md '지금 하던 일', 결제·운영 직전 멈춤은 건드리지 않고, 끝나면 맡긴 참모에게 [앱] 한 줄. 15초마다 보지만 파일은 정리 흐름 중인 참모의 인계 파일 시각만 읽는다(평소엔 이미 들고 있는 ctx·상태만).
// 흐름: 인계 말 → handoff.md 가 새로 써지고 턴이 끝나면 /compact → % 가 줄면 끝. 결과는 <데이터>/chief-compact.jsonl 한 줄
import { useEffect, useRef, useState } from 'react';
import { chiefCompactLog, chiefHandoff, projectHandoff, sendToSession } from '../data/tauri';
import { chatDrafts } from '../data/drafts';
import { compactStep, compactText, compactVerdict, COOL_MS, handoffText, typingNow, type Flow } from '../domain/chiefCompact';
import type { Ctx } from '../domain/ctx';
import { heldAtGate, PROJECT_MIN, projectCompactText, projectHandoffText, projectNoticeText } from '../domain/projectCompact';
import { lastSendTo } from '../domain/forwardQuestion';
import type { TaskEvent } from '../domain/tasks';
import { splitOrchName } from '../domain/orchLabel';
import type { Session } from '../domain/session';
import type { ActivityStatus } from '../domain/status';
import type { Activity } from '../domain/activity';
import { isShown } from './attention';
import { every } from './poll';

export const CHIEF_COMPACT_POLL_MS = 15_000;

type In = {
  on: boolean;
  orchs: Session[];
  /** 프로젝트 세션(참모·도우미 빼고) — 같은 스위치로 같이 */
  projects: Session[];
  /** 사람이 이 세션을 보고 있나(프로젝트 화면·세션 탭) — 참모는 chatTab 으로 */
  watching: (s: Session) => boolean;
  events: TaskEvent[];
  sessions: Session[];
  statusOf: (s: Session) => ActivityStatus;
  activityOf: (s: Session) => Activity | undefined;
  ctx: Record<string, Ctx>;
  /** 채팅 탭에 떠 있는 참모 id */
  chatTab: string | null;
  /** 답을 기다리는 카드를 띄운 세션 id */
  asking: string[];
};

const ms = (iso?: string) => (iso ? Date.parse(iso) : undefined);
/** 프로젝트 인계 — starter 나 예비 자리 중 늦게 고친 시각(격리 가드로 starter 를 못 고치면 예비에 쓴다) */
const newest = (h: { mtime: number; altMtime: number } | null) => (h ? Math.max(h.mtime, h.altMtime) : undefined);
const focusedWin = () => {
  try { return document.hasFocus(); } catch { return false; }
};

/** 정리 중인 참모 id → 단계(화면 작은 표시용) */
export function useChiefCompact(o: In): Record<string, Flow['phase']> {
  const cur = useRef(o);
  cur.current = o;
  type Run = Flow & { sid: string; path: string; name: string; project: boolean; alt?: string; wrote?: string };
  const flows = useRef(new Map<string, Run>());
  const cool = useRef(new Map<string, number>());
  const drafts = useRef(new Map<string, { text: string; at: number }>());
  const busy = useRef(false);
  const [shown, setShown] = useState<Record<string, Flow['phase']>>({});
  useEffect(() => {
    const publish = () => setShown(Object.fromEntries([...flows.current].map(([id, f]) => [id, f.phase])));
    const log = (rec: Record<string, unknown>) => void chiefCompactLog(JSON.stringify({ at: new Date().toISOString(), ...rec })).catch(() => {});
    const tick = async () => {
      const x = cur.current;
      if (busy.current) return;
      busy.current = true;
      try {
        const now = Date.now();
        const chiefIds = new Set(x.orchs.map((o) => o.id));
        const all = [...x.orchs.map((s) => ({ s, project: false })), ...x.projects.filter((s) => !chiefIds.has(s.id)).map((s) => ({ s, project: true }))];
        for (const { s, project } of all) {
          const f = flows.current.get(s.id);
          const sid = s.sessionId;
          const used = sid ? x.ctx[sid]?.used : undefined;
          const status = x.statusOf(s);
          if (f) {
            const ph = f.phase === 'handoff' && f.project ? await projectHandoff(s.cwd, s.id).catch(() => null) : null;
            const mtime = f.phase !== 'handoff' ? undefined : f.project ? newest(ph) : (await chiefHandoff(splitOrchName(s.name).base).catch(() => null))?.mtime;
            const step = compactStep(f, { now, status, used, mtime, idle: s.state !== 'working' });
            if (step.kind === 'compact') {
              await sendToSession(s.id, f.project ? projectCompactText(f.path, f.alt ?? '') : compactText(f.path));
              // 어디에 적었나 — starter 를 못 고치면(격리 가드) 예비 자리
              const wrote = ph && ph.altMtime > ph.mtime ? ph.alt : f.path;
              flows.current.set(s.id, { ...f, phase: 'compact', at: now, wrote });
              log({ name: f.name, project: f.project || undefined, step: 'compact', used, wrote: f.project ? wrote : undefined });
            } else if (step.kind === 'done' || step.kind === 'fail') {
              flows.current.delete(s.id);
              if (step.kind === 'fail') cool.current.set(s.id, now + COOL_MS);
              log({ name: f.name, project: f.project || undefined, step: step.kind, why: step.kind === 'fail' ? step.why : undefined, before: f.before, after: step.after, secs: Math.round((now - f.at) / 1000) });
              // 프로젝트 세션 — 맡긴 참모에게 [앱] 한 줄(그 세션에 건 조건을 다시 보낼 수 있게). 맡긴 기록이 없으면 안 보낸다
              if (f.project && step.kind === 'done') {
                const last = lastSendTo(s, x.events, x.orchs, x.sessions);
                if (last?.owner) await sendToSession(last.owner.id, projectNoticeText(s.name, s.id, Math.round(f.before), Math.round(step.after), f.wrote ?? f.path, { id: last.send.task, title: last.send.title })).catch(() => {});
              }
            }
            continue;
          }
          if (!x.on || !sid) continue;
          // 입력칸 글이 마지막으로 바뀐 때 — 잊고 둔 글 때문에 영영 미루지 않게
          const text = chatDrafts.load(s.id).text;
          const d = drafts.current.get(s.id);
          if (!d || d.text !== text) drafts.current.set(s.id, { text, at: now });
          const act = x.activityOf(s);
          if (project && heldAtGate(act)) continue; // 결제·운영 직전에 참모 답을 기다리는 세션
          const v = compactVerdict({
            used, status, now, min: project ? PROJECT_MIN : undefined,
            lastAt: ms(act?.lastAt),
            viewing: (x.chatTab === s.id || (project && x.watching(s))) && isShown() && focusedWin(),
            typing: typingNow(text, drafts.current.get(s.id)!.at, now),
            asking: x.asking.includes(s.id),
            coolUntil: cool.current.get(s.id),
          });
          if (v !== 'go' || used == null) continue;
          const name = project ? s.name : splitOrchName(s.name).base;
          const ph = project ? await projectHandoff(s.cwd, s.id).catch(() => null) : null;
          const h = project ? ph : await chiefHandoff(name).catch(() => null);
          if (!h) { cool.current.set(s.id, now + COOL_MS); continue; }
          flows.current.set(s.id, { phase: 'handoff', at: now, before: used, mtime0: ph ? newest(ph)! : h.mtime, sid, path: h.path, name, project, alt: ph?.alt });
          publish();
          log({ name, project: project || undefined, step: 'start', used });
          await sendToSession(s.id, ph ? projectHandoffText(ph.path, ph.git, ph.alt) : handoffText(h.path)).catch(() => { flows.current.delete(s.id); cool.current.set(s.id, now + COOL_MS); });
        }
      } catch {
        // 다음 차례에
      } finally {
        busy.current = false;
        publish();
      }
    };
    return every(() => void tick(), CHIEF_COMPACT_POLL_MS);
  }, []);
  return shown;
}
