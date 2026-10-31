// 폰 — 다른 기기 보기(peer-panel, 시안 v2 M1~M3). 폰은 이 맥만 알아서 그 기기 읽기는 이 맥이 대신(/api/peer-get), 말은 사람 길(/api/peer-human-say),
// 카드 답은 이미 있는 /api/peer-card-answer. 그 기기 보기는 앱을 새로 열면 늘 이 맥으로 시작한다(잘못 친 말이 그 기기로 가지 않게)
import { useEffect, useMemo, useState } from 'react';
import { farApi, farDevices, farHumanSay, peerCardAnswer, readPeerCards } from '../../data/web';
import { useFarRead, type Every, type FarLockerState } from '../far/useFarRead';
import type { FarSession } from '../../domain/farHome';
import { remoteCards, type PeerCardsRow } from '../../domain/remoteCards';
import { OrchAvatar, orchColor } from '../avatar';
import { DirectCardView } from '../chat/DirectCard';
import { IconClose, IconDevice } from '../Icons';
import { josa, machine, tr } from '../../i18n';
import { chatLoaded, useChatItems } from '../space/useChatItems';
import { ChatSheet } from './ChatSheet';
import { Composer } from './Composer';
import { BottomSheet, SheetHostProvider } from './kit';
import { MessageList } from './MessageList';
import { Notice } from './Notice';
import { usePoll } from './usePoll';
import type { Viewport } from './useViewport';
import type { Snap } from '../../domain/mobile';
import type { OutMsg } from '../../domain/mobileOutbox';
import { seenName } from '../../domain/session';

export type FarPick = { id: string; name: string };
const avState = (d: FarSession['dot']) => (d === 'run' ? 'work' : d === 'ask' ? 'ask' : 'rest');

/** 짝지은 기기(끊긴 기기도) — 하나도 없으면 기기 줄이 안 뜬다 */
export function useFarDevices(): FarPick[] {
  return usePoll<FarPick[]>(() => farDevices().catch(() => []), 30_000, []);
}

/** 이 컴퓨터를 부르는 말 — 폰 서버가 준 컴퓨터 이름(짝지은 기기 이름과 나란히), 없으면(옛 서버) '이 맥'(2026-10-23 사용자 "무슨 뜻인지 안 읽혀") */
export const selfDevice = (name?: string | null): string => name?.trim() || tr(`이 ${machine()}`, `This ${machine()}`);

/** 참모 시트 맨 위 기기 줄 — '기기' 제목 + 이 컴퓨터 + 짝지은 기기 */
export function FarPills({ devices, cur, self, waitDevs, onPick }: { devices: FarPick[]; cur: string | null; self?: string | null; waitDevs?: Set<string>; onPick: (d: FarPick | null) => void }) {
  if (!devices.length) return null;
  return (
    <>
      <div className="m-sect m-far-sect">{tr('기기', 'Devices')}</div>
      <div className="m-far-pills" role="group" aria-label={tr('기기', 'Devices')}>
        <button type="button" className={`m-far-pill ${cur ? '' : 'on'}`} onClick={() => onPick(null)}>{selfDevice(self)}</button>
        {devices.map((d) => (
          <button key={d.id} type="button" className={`m-far-pill far ${cur === d.id ? 'on' : ''}`} onClick={() => onPick(d)}>
            {d.name}{waitDevs?.has(d.id) && <i className="m-far-wait" aria-label={tr('결정 대기', 'Waiting for a decision')} />}
          </button>
        ))}
      </div>
    </>
  );
}

/** 폰 주기 — 화면이 숨으면 쉰다(폰이 이 맥을 거쳐 그 기기를 부르니 양쪽 다 아낀다) */
const phoneEvery: Every = (f, ms) => { const t = window.setInterval(() => { if (!document.hidden) f(); }, ms); return () => window.clearInterval(t); };

function useFarPhone(dev: string) {
  const api = useMemo(() => farApi(dev), [dev]);
  return { api, ...useFarRead(dev, api, phoneEvery) };
}

/** 그 기기를 보는 화면 — 맨 위 파란 줄 · 머리(참모) · 홈/보관함 · 채팅 시트(그 기기 참모에게 사람 말로) */
export function PhoneFar({ t, devices, self, onPick, vp }: { t: FarPick; devices: FarPick[]; self?: string | null; onPick: (d: FarPick | null) => void; vp: Viewport }) {
  const { api, home, err, locker } = useFarPhone(t.id);
  const [agentId, setAgentId] = useState<string | null>(null);
  const agent = home?.assistants.find((a) => a.id === agentId) ?? home?.assistants[0];
  const [tab, setTab] = useState<'home' | 'locker'>('home');
  const [snap, setSnap] = useState<Snap>('peek');
  const [picker, setPicker] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const rows = usePoll<PeerCardsRow[]>(() => readPeerCards().catch(() => []), 4000, []);
  const all = remoteCards(rows, Date.now());
  const cards = all.filter((c) => c.dev === t.id);
  const items = useChatItems(agent?.sessionId, snap === 'peek' ? 10_000 : 2500, api.readTranscript);
  const cut = !!err && !home;
  // 보내는 중·못 보낸 말 — 말풍선으로 남겨 다시 보내기·지우기(입력칸은 비우지만 글은 안 잃는다). 그 기기까지 맥을 거쳐 10초까지 걸린다
  const [out, setOut] = useState<OutMsg[]>([]);
  const deliver = (m: OutMsg) => {
    void farHumanSay(t.id, m.session, m.text).then(
      () => setOut((o) => o.filter((x) => x.id !== m.id)),
      (e: unknown) => setOut((o) => o.map((x) => (x.id === m.id ? { ...x, status: 'failed', error: (e as Error).message } : x))),
    );
  };
  const send = (text: string, paths: string[] = []): boolean => {
    // 붙인 그림·파일은 이 맥에 올라간 것이라 그 기기 참모가 못 연다 — 글만
    if (paths.length) { setNote(tr('그림·파일은 그 기기로 못 보내요 — 글만 보내요', 'Images and files can\'t be sent to that device — text only')); return false; }
    if (!agent || !text.trim()) return false;
    const m: OutMsg = { id: `far-${Date.now()}`, session: agent.id, text, at: Date.now(), status: 'sending' };
    setOut((o) => [...o, m]);
    deliver(m);
    return true;
  };
  const retry = (id: string) => { const m = out.find((x) => x.id === id); if (!m) return; const again = { ...m, status: 'sending' as const, error: undefined }; setOut((o) => o.map((x) => (x.id === id ? again : x))); deliver(again); };
  const drop = (id: string) => setOut((o) => o.filter((x) => x.id !== id));
  const color = orchColor(agent?.name ?? t.name);
  return (
    <div className="m-space m-far" style={{ ['--orch' as string]: color }}>
      <SheetHostProvider kb={vp.kb}>
        <div className={`m-far-bar ${cut ? 'cut' : ''}`} role="status">
          <IconDevice /><b>{cut ? tr(`${t.name} · 연결 끊김`, `${t.name} · disconnected`) : tr(`${t.name} 보는 중`, `Viewing ${t.name}`)}</b>
          <button type="button" className="m-far-back" onClick={() => onPick(null)} aria-label={tr(`${josa(selfDevice(self), '으로', '로')} 돌아가기`, `Back to ${selfDevice(self)}`)} title={tr(`${josa(selfDevice(self), '으로', '로')} 돌아가기`, `Back to ${selfDevice(self)}`)}><IconClose /></button>
        </div>
        <div className="m-far-hd">
          {agent && <OrchAvatar name={agent.name} size={36} state={avState(agent.dot)} color={orchColor(agent.name)} label={seenName(agent.name)} />}
          <div className="m-far-tx"><b>{agent ? seenName(agent.name) : t.name}</b><span>{agent ? `${t.name}${agent.doing ? ` · ${agent.doing}` : ''}` : cut ? tr('연결 끊김', 'Disconnected') : tr('읽는 중…', 'Reading…')}</span></div>
        </div>
        <div className="m-far-tabs" role="tablist">
          <button type="button" role="tab" aria-selected={tab === 'home'} className={tab === 'home' ? 'on' : ''} onClick={() => setTab('home')}>{tr('홈', 'Home')}</button>
          <button type="button" role="tab" aria-selected={tab === 'locker'} className={tab === 'locker' ? 'on' : ''} onClick={() => setTab('locker')}>{tr('보관함', 'Locker')}</button>
        </div>
        <div className="m-far-body">
          {cut ? (
            <div className="m-far-empty"><b>{tr(`${t.name}에 안 닿아요`, `Can't reach ${t.name}`)}</b><span>{tr('그 기기의 Chammo 가 꺼졌거나 잠자기예요. 켜지면 저절로 이어져요', 'Chammo on that device is off or asleep. It reconnects by itself when it\'s back')}</span></div>
          ) : tab === 'home' ? (
            <>
              {cards.map((c) => <DirectCardView key={c.card.id} c={c.card} name={c.name} onAnswer={peerCardAnswer(t.id)} />)}
              {!home && <span className="m-muted">{tr('읽는 중…', 'Reading…')}</span>}
              {home && home.groups.length === 0 && <span className="m-muted">{tr('지금 도는 세션이 없어요', 'No sessions running right now')}</span>}
              {home && home.groups.length > 0 && (
                <div className="m-far-rows">
                  <span className="m-far-cap">{tr('세션', 'Sessions')} {home.groups.reduce((n, g) => n + g.sessions.length, 0)}</span>
                  {home.groups.flatMap((g) => g.sessions).map((s) => (
                    <div key={s.id} className="m-far-row"><i className={`m-far-dot d-${s.dot}`} aria-hidden="true" /><b>{s.name}</b><span>{s.doing}</span></div>
                  ))}
                </div>
              )}
            </>
          ) : (
            <PhoneFarLocker name={t.name} locker={locker} />
          )}
        </div>
        <ChatSheet snap={snap} onSnap={setSnap} vh={vp.h} kb={vp.kb} peekLine={agent ? tr(`${seenName(agent.name)} · 사람 말로 가요`, `${seenName(agent.name)} · sent as you`) : t.name}
          composer={
            <Composer avatar={agent ? <OrchAvatar name={agent.name} size={28} state={avState(agent.dot)} color={orchColor(agent.name)} label={seenName(agent.name)} /> : <span />} orchName={agent ? seenName(agent.name) : t.name} waiting={0}
              placeholder={agent ? tr(`${seenName(agent.name)}에게`, `Message ${seenName(agent.name)}`) : tr(`${t.name} 참모를 고르세요`, `Pick an assistant on ${t.name}`)} maxInputH={Math.min(176, Math.round(vp.h * 0.26))} busy={false} stopping={false} onStop={() => {}}
              draftKey={`far:${t.id}:${agent?.id ?? ''}`} onChip={() => setPicker(true)} onFocus={() => snap === 'peek' && setSnap('half')} send={send} />
          }>
          {note && <Notice text={note} error onClose={() => setNote(null)} />}
          <MessageList items={items} out={out.filter((m) => m.session === agent?.id)} onRetry={retry} onDrop={drop} loading={!!agent?.sessionId && !chatLoaded(agent.sessionId)}
            who={agent ? <OrchAvatar name={agent.name} size={28} state="ask" color={orchColor(agent.name)} label={seenName(agent.name)} /> : undefined} />
        </ChatSheet>
        {picker && (
          <BottomSheet label={tr('참모 바꾸기', 'Switch assistant')} onClose={() => setPicker(false)} title={t.name}>
            <FarPills devices={devices} cur={t.id} self={self} waitDevs={new Set(all.map((c) => c.dev))} onPick={(d) => { setPicker(false); onPick(d); }} />
            {(home?.assistants ?? []).map((a) => (
              <button key={a.id} type="button" className={`m-far-orow ${agent?.id === a.id ? 'on' : ''}`} onClick={() => { setAgentId(a.id); setPicker(false); }}>
                <OrchAvatar name={a.name} size={36} state={avState(a.dot)} color={orchColor(a.name)} label={a.name} />
                <span className="m-far-tx"><b>{a.name}</b><span>{a.doing || (a.dot === 'rest' ? tr('쉼', 'Idle') : '')}</span></span>
                <i className={`m-far-dot d-${a.dot}`} aria-hidden="true" />
              </button>
            ))}
            <span className="m-muted m-far-hint">{tr('다른 기기 참모를 켜고 끄는 건 그 기기에서', 'Turn assistants on or off on their own device')}</span>
          </BottomSheet>
        )}
      </SheetHostProvider>
    </div>
  );
}

function PhoneFarLocker({ name, locker }: { name: string; locker: FarLockerState }) {
  if (locker === null) return <span className="m-muted">{tr('읽는 중…', 'Reading…')}</span>;
  if (locker === 'old') return <div className="m-far-empty"><b>{tr(`${josa(name, '을', '를')} 업데이트해야 보여요`, `Update ${name} to see this`)}</b><span>{tr('채팅·세션은 지금도 돼요', 'Chat and sessions still work')}</span></div>;
  if (locker === 'off') return <div className="m-far-empty"><b>{tr(`${name}에서 보관함 보여 주기를 껐어요`, `${name} has turned off locker sharing`)}</b></div>;
  if (locker === 'err') return <div className="m-far-empty"><b>{tr('보관함을 못 읽었어요', 'Couldn\'t read the locker')}</b></div>;
  const files = locker.flatMap((o) => o.files.map((f) => ({ ...f, owner: o.owner }))).sort((a, b) => b.mtime - a.mtime);
  if (!files.length) return <span className="m-muted">{tr('보관함이 비어 있어요', 'The locker is empty')}</span>;
  return (
    <div className="m-far-rows">
      <span className="m-far-cap">{tr('보관함 · 읽기 전용', 'Locker · read only')}</span>
      {files.map((f) => (
        <div key={`${f.owner}/${f.rel}`} className="m-far-row"><span className="m-far-ext">{f.name.includes('.') ? f.name.split('.').pop()!.slice(0, 4).toUpperCase() : ''}</span><b>{f.name}</b><span>{seenName(f.owner)}</span></div>
      ))}
    </div>
  );
}
