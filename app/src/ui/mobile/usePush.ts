// 폰 웹 푸시 켜기·끄기 — 서비스 워커(/sw.js)를 걸고, 켜면 알림 허락 → 맥 앱 키로 구독 → 맥에 등록. 끄면 맥에서 빼고 구독 해제.
// iOS 는 홈 화면에 붙인 앱에서만 된다(pushSupport). 맥이 알림을 보낼 때(참모 창을 안 보고 있을 때) 폰에 뜬다
import { useEffect, useState } from 'react';
import { getPushKey, pushSubscribe, pushUnsubscribe } from '../../data/web';
import { autoResubscribe, b64urlBytes, pushSupport, type PushSupport } from '../../domain/mobilePush';
import { isStandalone } from './standalone';

const support = (): PushSupport => {
  if (typeof navigator === 'undefined') return 'unsupported';
  return pushSupport({
    sw: 'serviceWorker' in navigator,
    push: typeof window !== 'undefined' && 'PushManager' in window,
    notif: typeof Notification !== 'undefined',
    standalone: isStandalone(),
    ios: /iPhone|iPad|iPod/.test(navigator.userAgent),
    permission: typeof Notification !== 'undefined' ? Notification.permission : 'default',
  });
};

/** 사용자가 종으로 직접 껐나 — 직접 끈 게 아니면 사라진 구독을 저절로 다시 한다 */
const OFF_KEY = 'm.pushOff';
const userOff = () => { try { return localStorage.getItem(OFF_KEY) === '1'; } catch { return false; } };
const setUserOff = (v: boolean) => { try { if (v) localStorage.setItem(OFF_KEY, '1'); else localStorage.removeItem(OFF_KEY); } catch { /* 개인 정보 보호 모드 */ } };

async function subscribeNow(reg: ServiceWorkerRegistration): Promise<PushSubscription> {
  const key = await getPushKey();
  const s = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64urlBytes(key) as BufferSource }));
  await pushSubscribe(s.toJSON());
  return s;
}

export function usePush() {
  const [can, setCan] = useState<PushSupport>(support);
  const [on, setOn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 걸어 둔 구독이 있으면 맥에 다시 알린다(맥을 다시 깔았거나 기기를 다시 짝지었을 때).
  // 없는데 알림이 허락돼 있고 직접 끈 게 아니면(앱 업데이트·서비스 워커 갱신으로 놓침) 묻지 않고 다시 구독한다
  useEffect(() => {
    if (can !== 'ok') return;
    let alive = true;
    void (async () => {
      try {
        const reg = await navigator.serviceWorker.register('/sw.js');
        await navigator.serviceWorker.ready;
        const s = await reg.pushManager.getSubscription();
        if (s) { void pushSubscribe(s.toJSON()).catch(() => {}); if (alive) setOn(true); return; }
        if (autoResubscribe({ can, permission: Notification.permission, hasSub: false, userOff: userOff() })) {
          await subscribeNow(reg);
          if (alive) setOn(true);
          return;
        }
        if (alive) setOn(false);
      } catch {
        if (alive) setOn(false);
      }
    })();
    return () => { alive = false; };
  }, [can]);

  const enable = async () => {
    setBusy(true);
    setError(null);
    try {
      if ((await Notification.requestPermission()) !== 'granted') { setCan(support()); throw new Error('알림을 허락해야 받을 수 있어요'); }
      await subscribeNow(await navigator.serviceWorker.ready);
      setUserOff(false);
      setOn(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const disable = async () => {
    setBusy(true);
    setError(null);
    try {
      const s = await (await navigator.serviceWorker.ready).pushManager.getSubscription();
      if (s) { await pushUnsubscribe(s.endpoint).catch(() => {}); await s.unsubscribe(); }
      setUserOff(true);
      setOn(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return { can, on, busy, error, setError, enable: () => void enable(), disable: () => void disable() };
}
export type Push = ReturnType<typeof usePush>;
