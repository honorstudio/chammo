// 키즈 참모 만들기 E2E(11-17 사용자 "만든 후에 들어가니까 얘한테 다시 설명해 줘야 함") — 진짜 새 참모 창(데스크톱 NameNew·폰 NewOrchForm).
// ?face=desk|phone · ?kids=1 이면 설정 키즈 모드가 켜진 채. 만들기를 누르면 넘긴 값을 window.__made 에
import { createRoot } from 'react-dom/client';

const q = new URLSearchParams(location.search);
const w = window as unknown as { __TAURI_INTERNALS__: unknown; __made: unknown[] };
w.__made = [];
w.__TAURI_INTERNALS__ = {
  invoke: async (cmd: string) => {
    if (cmd === 'app_env') return { home: '/u', devRoot: '/u/dev', extraProjects: [], dataDir: '/u/.chammo', ttsCommand: 'say', orchestratorCwd: '/u/hq' };
    if (cmd === 'avatars_read') return [];
    if (cmd === 'orch_roles_read') return {};
    return null;
  },
  transformCallback: () => 0,
  convertFileSrc: (p: string) => p,
};
const kids = !!q.get('kids');

(async () => {
  await import('@src/ui/layers.css');
  if (q.get('face') === 'phone') {
    await import('@src/ui/mobile/mobile.css');
    const { NewOrchForm } = await import('@src/ui/mobile/OrchWake');
    const wake = { make: async (nick: string, role: string, kid: unknown) => { w.__made.push({ nick, role, kid }); return true; } } as never;
    createRoot(document.getElementById('root')!).render(
      <div className="m-app" style={{ padding: 16, background: 'var(--bg)', minHeight: '100vh' }}><NewOrchForm title="참모" taken={[]} wake={wake} onDone={() => {}} kids={kids} /></div>,
    );
    return;
  }
  await import('@src/ui/styles.css');
  await import('@src/ui/setup.css'); // 앱은 Setup 을 늘 불러와 설정 스위치(cfg-sw)가 어디서나 있다
  await import('@src/ui/avatar/avatar.css');
  const { NameNew } = await import('@src/ui/OrchDialogs');
  createRoot(document.getElementById('root')!).render(
    <NameNew baseName="참모-6" color="#e0663a" check={() => null} onCancel={() => {}} kids={kids} onMake={(v, role, kid) => w.__made.push({ nick: v, role, kid })} />,
  );
})();
