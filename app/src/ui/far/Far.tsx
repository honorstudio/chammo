// 다른 기기 보기(peer-panel, 시안 v2 C) — 띠 맨 위 기기 단추 → 기기 목록 → 그 기기로 바꾸면 띠·채팅·스페이스가 통째로 그 기기.
// 읽기는 그 기기 폰 서버(remoteApi — peer 열쇠 허용 목록), 말은 사람 길(RemoteChat → remote_human_say), 카드 답도 사람 길(remote_direct_answer).
// 읽기는 이 화면이 떠 있을 때만 — 기기 단추만 있을 땐 짝지은 목록 파일(remote_saved)만 본다(ADR 0011 받는 기기 CPU 조건)
import { useEffect, useMemo, useRef, useState } from 'react';
import { remoteApi, remoteSaved, type RemoteDevice } from '../../data/remote';
import type { FarSession } from '../../domain/farHome';
import type { RemoteCard } from '../../domain/remoteCards';
import type { RemoteChatTarget } from '../chat/RemoteChat';
import { orchColor } from '../avatar';
import { every } from '../poll';
import { FarBar, FarButton, FarPop, FarRail } from './FarParts';
import { FarSpace } from './FarSpace';
import { useFarRead, type FarRead } from './useFarRead';

export type FarTarget = { dev: string; name: string };

/** 짝지은 기기(끊긴 기기도) — 파일 하나라 가볍다. 하나도 없으면 단추가 안 뜬다 */
export function useSavedDevices(): { id: string; name: string }[] {
  const [v, setV] = useState<{ id: string; name: string }[]>([]);
  useEffect(() => {
    let alive = true;
    const tick = () => void remoteSaved().then((r) => { if (alive) setV((p) => (JSON.stringify(p) === JSON.stringify(r) ? p : r)); }, () => {});
    tick();
    const stop = every(tick, 30_000);
    return () => { alive = false; stop(); };
  }, []);
  return v;
}

export type FarData = FarRead;

/** 그 기기 읽기 — 공통 한 벌(useFarRead), 데스크톱은 앱 주기(창이 가려지면 5배 느리게) */
export function useFarData(dev: string): FarData {
  const api = useMemo(() => (dev ? remoteApi(dev) : null), [dev]);
  return useFarRead(dev, api, every);
}

export const FAR_PICK = 'chammo-far-pick';
export const FAR_NUM = 'chammo-far-num';
/** 그 기기를 보는 중엔 막는 단축키 — 숨은 이 맥 화면(세션·탭·보관함·메모·창 크게)에 먹는 것 */
export const FAR_BLOCKED = new Set(['closePane', 'closeTab', 'newDoc', 'newSession', 'goHome', 'goLocker', 'memo', 'maximizePane', 'moveTab', 'nav', 'search']);
let farOn = false;
export const farActive = () => farOn;

/** 기기 보기 상태 한 덩어리 — App 은 넘겨받은 조각(띠 단추·바뀐 띠·스페이스·맨 위 줄·목록)만 끼운다.
 *  채팅 칸은 이미 있는 원격 채팅(remoteChat, ADR 0011)을 그대로 쓴다 — 설정 > 다른 기기 참모에서 연 채팅도 그 기기 보기로 들어온다 */
export function useFarMode(o: { remoteChat: RemoteChatTarget | null; setRemoteChat: (t: RemoteChatTarget | null) => void; cards: RemoteCard[]; fontSize: number; onConnect: () => void }) {
  const saved = useSavedDevices();
  const [far, setFar] = useState<FarTarget | null>(null);
  const [status, setStatus] = useState<RemoteDevice | undefined>();
  const [pop, setPop] = useState<{ left: number; top: number } | null>(null);
  const agentOf = useRef(new Map<string, string>());
  const data = useFarData(far?.dev ?? '');
  const { remoteChat, setRemoteChat } = o;
  useEffect(() => { farOn = !!far; return () => { farOn = false; }; }, [far]);
  const chat = (a: FarSession, t = far) => {
    if (!t) return;
    agentOf.current.set(t.dev, a.id);
    setRemoteChat({ dev: t.dev, devName: t.name, agent: a.id, name: a.name });
  };
  // 설정에서 연 원격 채팅도 그 기기 보기로(입구는 띠가 주인, 설정은 대피로)
  useEffect(() => {
    if (remoteChat && far?.dev !== remoteChat.dev) { agentOf.current.set(remoteChat.dev, remoteChat.agent); setFar({ dev: remoteChat.dev, name: remoteChat.devName }); }
  }, [remoteChat]); // eslint-disable-line react-hooks/exhaustive-deps
  // 그 기기 홈이 오면 그 기기에서 마지막으로 보던 참모(처음이면 맨 위)를 가운데에
  useEffect(() => {
    if (!far || !data.home || remoteChat?.dev === far.dev) return;
    const want = agentOf.current.get(far.dev);
    const a = data.home.assistants.find((x) => x.id === want) ?? data.home.assistants[0];
    if (a) chat(a);
  }, [far?.dev, data.home]); // eslint-disable-line react-hooks/exhaustive-deps
  const back = () => { setFar(null); setStatus(undefined); setPop(null); setRemoteChat(null); };
  const pick = (t: FarTarget, d: RemoteDevice | undefined) => {
    setPop(null);
    if (far?.dev === t.dev) return;
    setStatus(d);
    if (remoteChat) setRemoteChat(null);
    setFar(t);
  };
  const openAt = (el: Element | null) => {
    const r = el?.getBoundingClientRect();
    setPop((p) => (p ? null : { left: Math.round((r?.right ?? 56) + 8), top: Math.round(r?.top ?? 46) }));
  };
  useEffect(() => {
    const onPick = () => { if (saved.length) openAt(document.querySelector('.far-btn')); };
    const onNum = (e: Event) => { const a = data.home?.assistants[(e as CustomEvent<number>).detail - 1]; if (a) chat(a); };
    window.addEventListener(FAR_PICK, onPick);
    window.addEventListener(FAR_NUM, onNum);
    return () => { window.removeEventListener(FAR_PICK, onPick); window.removeEventListener(FAR_NUM, onNum); };
  });
  const devCards = far ? o.cards.filter((c) => c.dev === far.dev) : [];
  const button = (isFar: boolean) => <FarButton far={isFar} open={!!pop} wait={!isFar && o.cards.length > 0} onClick={(e) => openAt(e.currentTarget)} />;
  const color = orchColor(remoteChat?.name ?? '');
  return {
    far,
    railTop: saved.length > 0 && !far ? button(false) : undefined,
    farView: far ? {
      color,
      none: !!data.home && data.home.assistants.length === 0,
      cut: !!data.err && !data.home,
      rail: <FarRail button={button(true)} assistants={data.home?.assistants ?? []} on={remoteChat?.dev === far.dev ? remoteChat.agent : null} onPick={(a) => chat(a)} />,
      main: <FarSpace key={far.dev} t={far} data={data} status={status} cards={devCards} agent={remoteChat?.agent ?? null} onAgent={(a) => chat(a)} fontSize={o.fontSize} />,
    } : undefined,
    bar: far ? <FarBar name={far.name} cut={!!data.err} onBack={back} /> : null,
    pop: pop ? (
      <div className="far-pop-at" style={{ left: pop.left, top: pop.top }}>
        <FarPop saved={saved} cur={far?.dev ?? null} waitDevs={new Set(o.cards.map((c) => c.dev))} onPick={pick} onHere={back} onClose={() => setPop(null)} onConnect={() => { setPop(null); o.onConnect(); }} />
      </div>
    ) : null,
  };
}
