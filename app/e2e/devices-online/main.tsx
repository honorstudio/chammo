// 기기 관리 '붙음' 받침 — 진짜 DevicesSection 에 가짜 invoke. 기기 이름은 지어낸 값, 모양은 11-18 00:56 실제 화면 그대로(마지막 시각이 중계에 1시간에 한 번만 적힌 상태).
// ?live=none 이면 붙은 목록을 못 받은 셈(마지막 시각 65분 창), 아니면 허브가 아이맥·윈도우를 붙었다고 한 셈
import { createRoot } from 'react-dom/client';
import '../../src/ui/layers.css';
import '../../src/ui/styles.css';
import '../../src/ui/setup.css';

const NOW = Date.now();
const min = (m: number) => NOW - m * 60_000;
const dev = (id: string, name: string, kind: string, seen: number, current = false) => ({ id, name, current, kind, status: 'approved', lastSeen: seen, reqCity: '', reqCountry: '', pendingSince: null, approvedBy: 'human' });
const live = new URLSearchParams(location.search).get('live') === 'none' ? null : ['imac', 'win'];
const view = {
  account: { id: 'a', email: 'me@gmail.com', name: '' }, pending: false,
  devices: [dev('me', 'Momo Air', 'mac', NOW, true), dev('mbp', 'momo-MacBookPro', 'mac', min(12)), dev('imac', 'studio-iMac', 'mac', min(33)), dev('ip', 'iPhone', 'phone', min(37)), dev('win', 'DESKTOP-MOMO123', 'win', min(53)), dev('old', 'Galaxy', 'phone', min(60 * 30))],
};
const invoke = async (cmd: string) => {
  switch (cmd) {
    case 'team_status': return view;
    case 'devices_online': return live;
    case 'mobile_status': return { on: false, running: false, relayReady: true, off: false, devices: [], relay: { on: true, connected: true, phones: 0, error: null } };
    case 'remote_saved': return [];
    case 'remote_devices': return { me: 'me', devices: [] };
    case 'peer_relay_state': return {};
    case 'chammo_here': return [];
    case 'direct_log': return '';
    case 'e2e_self_step': return '';
    default: return null;
  }
};
(window as unknown as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = { invoke, transformCallback: () => 0, unregisterCallback: () => {}, convertFileSrc: (p: string) => p };
const { DevicesSection } = await import('../../src/ui/DevicesSection');
createRoot(document.getElementById('root')!).render(<DevicesSection title="기기 관리" onAccount={() => {}} fallback={null} />);
