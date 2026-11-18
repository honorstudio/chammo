// 키즈 참모 프로필 E2E(11-17 사용자 "키즈모드 참모에서 프로필 바꾸면 자꾸 알아서 해제됨"·"모드 체크버튼 왜 이렇게 큼") — 진짜 AvatarPicker 를 띄우고
// 앱처럼 부모를 0.5초마다 다시 그린다(nick 을 매번 새 객체로 넘긴다). 앱 명령은 가짜 — kids_read·kids_set 을 window 에 남긴다.
// ?kid=1 이면 이미 키즈 참모인 채로 연다
import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';

type Kids = Record<string, { child: string; age: number; since: number }>;
type W = { __TAURI_INTERNALS__: unknown; __kids: Kids; __kidsSet: { key: string; on: boolean; child: string; age: number }[]; __nick?: string; __closed?: boolean };
const w = window as unknown as W;
w.__kids = new URLSearchParams(location.search).get('kid') ? { '참모-5': { child: '서아', age: 5, since: 1 } } : {};
w.__kidsSet = [];
let lockSet = false;
// 일곱째 조각 — 말 앞단 API 키(넣었나만)·패드 패스키 수(?pk=1 이면 하나)
let apiSet = false;
let pk = new URLSearchParams(location.search).get('pk') ? 1 : 0;
const view = (x: Record<string, unknown> = {}) => ({ on: true, orchs: { ...w.__kids }, lock: lockSet, daily: 20, time: {}, api: apiSet, passkey: pk, ...x });
w.__TAURI_INTERNALS__ = {
  invoke: async (cmd: string, args: Record<string, unknown>) => {
    if (cmd === 'kids_read') return view({ time: { '참모-5': { usedMs: 12 * 60_000, limitMs: 20 * 60_000, leftMs: 8 * 60_000 } } });
    if (cmd === 'kids_api_key_set') { if (!String((args as { key: string }).key).startsWith('sk-ant-')) throw new Error('Anthropic API 키(sk-ant-…)가 아니야'); apiSet = true; return view(); }
    if (cmd === 'kids_api_key_clear') { apiSet = false; return view(); }
    if (cmd === 'kids_passkey_clear') { pk = 0; return view(); }
    if (cmd === 'kids_lock_set') { lockSet = true; return { on: true, orchs: { ...w.__kids }, lock: true, daily: 20, time: {} }; }
    if (cmd === 'kids_daily_set') return { on: true, orchs: { ...w.__kids }, lock: lockSet, daily: (args as { min: number }).min, time: {} };
    if (cmd === 'kids_set') {
      const a = args as W['__kidsSet'][number];
      w.__kidsSet.push(a);
      if (a.on) w.__kids[a.key] = { child: a.child, age: a.age, since: 1 };
      else delete w.__kids[a.key];
      return { on: true, orchs: { ...w.__kids } };
    }
    if (cmd === 'app_env') return { home: '/u', devRoot: '/u/dev', extraProjects: [], dataDir: '/u/.chammo', ttsCommand: 'say', orchestratorCwd: '/u/hq' };
    if (cmd === 'avatars_read') return [];
    if (cmd === 'kids_log') return [];
    if (cmd === 'kids_say') { (window as unknown as { __kidSaid: unknown[] }).__kidSaid = [...((window as unknown as { __kidSaid?: unknown[] }).__kidSaid ?? []), args]; return null; }
    return null;
  },
  transformCallback: () => 0,
  convertFileSrc: (p: string) => p,
};

(async () => {
  await import('@src/ui/layers.css');
  await import('@src/ui/styles.css');
  await import('@src/ui/setup.css'); // 앱은 Setup 을 늘 불러와 설정 스위치(cfg-sw)가 어디서나 있다
  const { AvatarPicker } = await import('@src/ui/avatar/AvatarPicker');
  // ?lock=1 — 설정 > 키즈 모드 아래 부모 잠금·하루 시간(여섯째 조각)
  if (new URLSearchParams(location.search).get('lock')) {
    const { KidsLockRow } = await import('@src/ui/kids/KidsLockRow');
    createRoot(document.getElementById('root')!).render(<div className="cfg-rows" style={{ width: 520, margin: 30, background: 'var(--surface)', padding: 16, borderRadius: 12 }}><label className="cfg-row"><span className="cfg-rt"><b>키즈 모드</b><span>참모 프로필에서 아이와 함께 쓸 참모를 정할 수 있어요</span></span><input type="checkbox" role="switch" className="cfg-sw" checked readOnly /></label><KidsLockRow /></div>);
    return;
  }
  // ?menu=1 — 참모 줄 오른쪽 클릭 메뉴(맨 위 '아이 화면으로', 11-17 사용자)
  if (new URLSearchParams(location.search).get('menu')) {
    const { OrchActionsProvider, useOrchActions } = await import('@src/ui/orchActions');
    const s = { id: 'o5', sessionId: 's5', name: '참모-5 · 선생님', cwd: '/u/hq', state: 'idle', kind: 'background' } as never;
    function Row() {
      const a = useOrchActions();
      return <button id="orch-row" style={{ margin: 40, padding: '10px 16px' }} onContextMenu={(e) => a?.menu(e, s, '#d9622b')}>선생님</button>;
    }
    createRoot(document.getElementById('root')!).render(<OrchActionsProvider onStop={() => {}} onRemove={() => {}}><Row /></OrchActionsProvider>);
    return;
  }
  function Parent() {
    const [tick, setTick] = useState(0);
    const [open, setOpen] = useState(true);
    useEffect(() => {
      const i = setInterval(() => setTick((x) => x + 1), 500);
      return () => clearInterval(i);
    }, []);
    if (!open) return <div id="closed">닫힘 {tick}</div>;
    return <AvatarPicker name="참모-5 · 선생님" label="선생님" color="#d9622b" nick={{ current: '선생님', fallback: '참모-5', onSave: (v: string) => { w.__nick = v; } }} onClose={() => { w.__closed = true; setOpen(false); }} />;
  }
  createRoot(document.getElementById('root')!).render(<Parent />);
})();
