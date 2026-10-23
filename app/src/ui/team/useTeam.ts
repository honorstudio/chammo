// 메신저 읽기 — 팀 상태 + 받은 말(team_feed). Rust 가 새 말마다 window.__teamMsg 를 부르면 다시 읽고, 놓친 것은 15초 주기로.
// 읽음(방마다 본 seq)은 localStorage — 메인 창과 메신저 따로 창이 같은 출처라 같이 본다(storage 사건으로 서로 맞춘다)
import { useCallback, useEffect, useRef, useState } from 'react';
import { teamFeed, type TeamFeed } from '../../data/teamApi';
import { markRead, type TeamItem } from '../../domain/teamChat';
import { every } from '../poll';

type Poke = { room: string; seq: number; note: string };
type Dock = { key: string; place: 'window' | 'app' };

// Rust eval 이 부르는 전역은 하나라 여기서 나눠 준다(이 앱은 capabilities 가 없어 이벤트 listen 이 막혀 있다)
const msgSubs = new Set<(p: Poke) => void>();
const dockSubs = new Set<(d: Dock) => void>();
const w = window as unknown as { __teamMsg?: (p: Poke) => void; __teamDock?: (d: Dock) => void };
w.__teamMsg = (p) => msgSubs.forEach((f) => f(p));
w.__teamDock = (d) => dockSubs.forEach((f) => f(d));

export function onTeamDock(f: (d: Dock) => void): () => void {
  dockSubs.add(f);
  return () => { dockSubs.delete(f); };
}

const READ_KEY = 'chammo.teamRead';
const HANDED_KEY = 'chammo.teamHanded';
const load = <T,>(k: string, d: T): T => { try { return (JSON.parse(localStorage.getItem(k) ?? '') as T) ?? d; } catch { return d; } };
const keep = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* 이번 실행만 */ } };

export type TeamData = {
  feed: TeamFeed | null;
  err: string | null;
  read: Record<string, number>;
  /** 내 참모에게 넘긴 말(방:seq → 넘긴 참모 이름) */
  handed: Record<string, string>;
  refresh: () => void;
  markRoom: (room: string) => void;
  markHanded: (it: TeamItem, to: string) => void;
};

export function useTeam(): TeamData {
  const [feed, setFeed] = useState<TeamFeed | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [read, setRead] = useState<Record<string, number>>(() => load(READ_KEY, {}));
  const [handed, setHanded] = useState<Record<string, string>>(() => load(HANDED_KEY, {}));
  const alive = useRef(true);
  const refresh = useCallback(() => {
    void teamFeed().then((f) => { if (alive.current) { setFeed(f); setErr(null); } }, (e: unknown) => { if (alive.current) setErr(String(e)); });
  }, []);
  useEffect(() => {
    alive.current = true;
    refresh();
    const stop = every(refresh, 15_000);
    const poke = () => refresh();
    msgSubs.add(poke);
    const sync = (e: StorageEvent) => {
      if (e.key === READ_KEY) setRead(load(READ_KEY, {}));
      if (e.key === HANDED_KEY) setHanded(load(HANDED_KEY, {}));
    };
    window.addEventListener('storage', sync);
    return () => { alive.current = false; stop(); msgSubs.delete(poke); window.removeEventListener('storage', sync); };
  }, [refresh]);
  const markRoom = useCallback((room: string) => {
    if (!room || !feed) return;
    setRead((r) => {
      const n = markRead(r, room, feed.items);
      if (n !== r) keep(READ_KEY, n);
      return n;
    });
  }, [feed]);
  const markHanded = useCallback((it: TeamItem, to: string) => {
    setHanded((h) => { const n = { ...h, [`${it.room}:${it.seq}`]: to }; keep(HANDED_KEY, n); return n; });
  }, []);
  return { feed, err, read, handed, refresh, markRoom, markHanded };
}
