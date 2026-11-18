// 키즈 참모 보호자 채팅에 아이 화면 대화를 끼운다(두 세션을 한 줄기로, docs/plans/kids-mode.md C).
// 키즈 모드가 켜졌고 그 참모가 키즈 참모일 때만 4초마다 kids_log(아이 세션 새 답을 옮기고 읽기)를 부른다
import { useEffect, useState } from 'react';
import { kidsLog, kidsRead, kidsWork, kidsWorks, type KidsView } from '../../data/tauri';
import { avatarKey } from '../../domain/avatar';
import { kidsLines, type KidsLine, type KidsRow } from '../../domain/kids';
import { kidsToday } from '../../domain/kidsToday';
import { KidsTodayCard } from './KidsTodayCard';
import type { Session } from '../../domain/session';
import { tr } from '../../i18n';

const EVERY = 4000;

function Line({ l, child }: { l: KidsLine; child: string }) {
  if (l.kind === 'app') return <div className="chat-row"><div className="chat-relay app"><div className="who">{tr('아이 화면', 'Kids screen')}</div><div className="body">{l.text}</div></div></div>;
  const who = l.kind === 'kid' ? child || tr('아이', 'Child') : tr('아이 화면 답', 'Kids screen reply');
  return <div className="chat-row"><div className="chat-relay kids"><div className="who">{who}</div><div className="body">{l.text}</div></div></div>;
}

export function useKidsChat(orchs: Session[], on: boolean) {
  const [view, setView] = useState<KidsView | null>(null);
  const [rows, setRows] = useState<Record<string, KidsRow[]>>({});
  // 오늘 만든 것(계획서 H) — 작품 목록은 만들기·고치기 줄이 늘 때만 다시 읽는다
  const [works, setWorks] = useState<Record<string, { name: string; title: string; mtime: number }[]>>({});
  const appSig = Object.entries(rows).map(([k, r]) => `${k}:${r.filter((x) => x.who === 'app').length}`).join('|');
  useEffect(() => {
    if (!appSig) return;
    let live = true;
    appSig.split('|').forEach((s) => { const k = s.slice(0, s.lastIndexOf(':')); void kidsWorks(k).then((w) => { if (live) setWorks((m) => ({ ...m, [k]: w })); }, () => {}); });
    return () => { live = false; };
  }, [appSig]);
  const keys = on && view?.on ? [...new Set(orchs.map((o) => avatarKey(o.name)).filter((k) => !!view.orchs[k]))] : [];
  const sig = keys.join('|');
  useEffect(() => {
    if (!on) { setView(null); return; }
    let live = true;
    const read = () => void kidsRead().then((v) => { if (live) setView(v); }).catch(() => {});
    read();
    const i = setInterval(read, 15_000);
    return () => { live = false; clearInterval(i); };
  }, [on]);
  useEffect(() => {
    if (!sig) { setRows({}); return; }
    let live = true;
    const pull = () => sig.split('|').forEach((k) => void kidsLog(k).then((r) => { if (live) setRows((m) => (JSON.stringify(m[k]) === JSON.stringify(r) ? m : { ...m, [k]: r })); }).catch(() => {}));
    pull();
    const i = setInterval(pull, EVERY);
    return () => { live = false; clearInterval(i); };
  }, [sig]);
  /** 그 참모 채팅에 끼울 줄 */
  const extraOf = (s: Session) => {
    const k = avatarKey(s.name);
    const r = rows[k];
    if (!r?.length || !view?.orchs[k]) return [];
    const child = view.orchs[k]!.child;
    return kidsLines(r).map((l) => ({ ts: l.ts, key: l.key, node: <Line l={l} child={child} /> }));
  };
  /** 그 참모 입력칸 위 '오늘 만든 것' 한 줄 — 오늘 한 게 없으면 null */
  const todayOf = (s: Session) => {
    const k = avatarKey(s.name);
    if (!view?.orchs[k]) return null;
    const t = kidsToday(rows[k] ?? [], works[k] ?? [], view.time?.[k], new Date().setHours(0, 0, 0, 0));
    return t ? <KidsTodayCard today={t} child={view.orchs[k]!.child} open={(name) => kidsWork(k, name)} /> : null;
  };
  return { extraOf, todayOf };
}
