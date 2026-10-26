// 다른 기기 참모 채팅(ADR 0011) — 지금 참모 채팅 칸과 같은 모양(.cell + ChatView), 읽기는 그 기기 폰 서버(remoteApi), 보내기는 사람 길(remote_human_say).
// 뒤 터미널이 없어서 ChatView 를 remote 로 — 터미널·모델·/·보관함·그림·멈춤은 꺼진다. 보내기는 이 칸 안의 진짜(isTrusted) 키·클릭 직후만
import { invoke } from '@tauri-apps/api/core';
import { useCallback, useEffect, useRef, useState } from 'react';
import { remoteApi } from '../../data/remote';
import { oldSayError, remoteAssistants, sayTooOld, sendAllowed } from '../../domain/remoteChat';
import { tr } from '../../i18n';
import { every } from '../poll';
import { ChatView } from './ChatView';

/** version = 그 기기 Chammo 판(기기 목록이 알면) — 원격 말 걸기 전 판이면 보내기 전에 알린다 */
export type RemoteChatTarget = { dev: string; devName: string; agent: string; name: string; version?: string };
/** 설정 > 다른 기기 참모에서 '채팅'을 누르면 — App 이 채팅 열을 그 참모로 바꾼다(detail = RemoteChatTarget) */
export const REMOTE_CHAT_EVENT = 'chammo-remote-chat';

const noop = () => {};

export function RemoteChat({ target, fontSize }: { target: RemoteChatTarget; fontSize?: number }) {
  const { dev, agent } = target;
  const tooOld = tr(`${target.devName} Chammo 판이 낮아 말 걸기가 안 돼요 — 그 기기를 업데이트해 주세요`, `${target.devName} is on an older Chammo that can't take messages — please update it`);
  const api = remoteApi(dev);
  const [sid, setSid] = useState<string | undefined>();
  const [state, setState] = useState('idle');
  const [err, setErr] = useState<string | null>(null);
  const trustedAt = useRef(0);

  useEffect(() => {
    setSid(undefined);
    let alive = true;
    let hq = '';
    const tick = async () => {
      try {
        if (!hq) hq = (await api.getEnv()).hqDir;
        const me = remoteAssistants(await api.listSessionsRaw(), hq).find((a) => a.id === agent);
        if (!alive) return;
        if (!me) { setErr(tr('그 기기에서 이 참모가 꺼졌어요', 'This assistant stopped on that device')); return; }
        setSid(me.sessionId);
        setState(me.state);
        setErr(null);
      } catch (e) {
        if (alive) setErr(tr(`그 기기에 안 닿아요 — ${String(e)}`, `Can't reach that device — ${String(e)}`));
      }
    };
    void tick();
    const stop = every(() => void tick(), 3000);
    return () => { alive = false; stop(); };
  }, [api, agent]);

  const mark = (e: React.SyntheticEvent) => { trustedAt.current = e.nativeEvent.isTrusted ? Date.now() : 0; };
  const send = useCallback((text: string) => {
    if (!sendAllowed(trustedAt.current, Date.now())) { setErr(tr('이 칸에서 직접 친 말만 보내요 — 다시 쳐 줘', 'Only what you type here is sent — type it again')); return; } // 앱이 저절로 다시 보내는 길은 안 간다
    trustedAt.current = 0;
    if (sayTooOld(target.version)) { setErr(tooOld); return; } // 옛 판은 보내 봐야 '그 길 없음'으로 튕긴다(10-26 영상 PC 0.3.9)
    void invoke('remote_human_say', { id: dev, to: agent, text }).then(() => setErr(null), (e: unknown) => setErr(oldSayError(String(e)) ? tooOld : tr(`못 보냈어요 — ${String(e)}`, `Not sent — ${String(e)}`)));
  }, [dev, agent, target.version, tooOld]);

  return (
    <div className="tabbed">
      <div className="gridbox">
        <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 1fr)', gridTemplateRows: 'minmax(0, 1fr)' }}>
          <div className="cell">
            <div className="pane headless" onKeyDownCapture={mark} onClickCapture={mark}>
              <ChatView remote readFn={api.readTranscript} fontSize={fontSize} sessionId={sid} state={state} send={send}
                interrupt={noop} onTerminal={noop} submitTerminal={noop} pasteImage={noop} clearTerminal={noop} sendQueuedNow={noop}
                paneId={`remote:${dev}:${agent}`} notice={err ? <span>{err}</span> : undefined} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
