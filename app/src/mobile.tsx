// 폰(모바일 웹) 진입점 — 맥 앱 모바일 서버가 테일스케일로 내보낸다. Tauri 없이 data/web.ts 로 /api 를 부른다
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MobileApp } from './ui/mobile/MobileApp';
import { PairHelp } from './ui/mobile/PairHelp';
import './ui/mobile/mobile.css';

import { avatarBlobUrl, pair, readAvatarsForPhone } from './data/web';
import { pairCodeFrom } from './domain/mobileAuth';
import { refreshAvatars, setAvatarSource } from './ui/avatar';
import { RESUME_EVENT } from './domain/poller';
import { blockPageZoom } from './ui/mobile/zoomGuard';
import { hideBootSplash } from './ui/mobile/bootSplash';

// 앱처럼 — 페이지 전체 확대(핀치·더블탭)는 막고 그림 보기 같은 칸 안에서만(ZoomBox)
blockPageZoom();

// 참모 프사는 Rust 명령 대신 모바일 서버에서 — 그림은 토큰 실어 받은 blob 주소(키로만)
setAvatarSource({ read: readAvatarsForPhone, dataDir: () => Promise.resolve('phone'), image: (e) => avatarBlobUrl(e.key) });
// 돌아오거나(백그라운드·망) 다시 붙으면 다시 읽는다 — 데스크톱에서 바꾼 프로필도, 맥 재시작 중에 실패한 첫 읽기도 여기서 메워진다
window.addEventListener(RESUME_EVENT, () => { void refreshAvatars(); });

const root = createRoot(document.getElementById('root')!);
const show = () => root.render(<StrictMode><MobileApp /></StrictMode>);

// QR 로 열었으면 — 일회용 코드를 내고 이 기기 토큰을 받아 저장한 뒤 주소에서 코드를 지운다
const code = pairCodeFrom(location.search);
if (code) {
  history.replaceState(null, '', '/');
  pair(code).then(show, (e: unknown) => {
    hideBootSplash(); // 첫 그림(모찌)이 덮고 있다 — 못 했다는 말이 보이게
    root.render(<><div className="m-center"><h1>연결 못 했어요</h1><p>{(e as Error).message}</p></div><PairHelp /></>);
  });
} else {
  show();
}
