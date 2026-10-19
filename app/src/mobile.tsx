// 폰(모바일 웹) 진입점 — 맥 앱 모바일 서버가 테일스케일로 내보낸다. Tauri 없이 data/web.ts 로 /api 를 부른다
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MobileApp } from './ui/mobile/MobileApp';
import { ErrorBoundary } from './ui/ErrorBoundary';
import { PairHelp } from './ui/mobile/PairHelp';
import './ui/layers.css';
import './ui/mobile/mobile.css';
import './ui/paused.css';

import { avatarBlobUrl, hasToken, homeTried, markHomeTried, newPairCode, pair, readAvatarsForPhone } from './data/web';
import { bootPair, homeCodeFrom, homeUrl, pairCodeFrom, spentBy } from './domain/mobileAuth';
import { isStandalone } from './ui/mobile/standalone';
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
const show = () => root.render(<StrictMode><ErrorBoundary><MobileApp /></ErrorBoundary></StrictMode>);

/** 홈 화면 앱 넘기기 — 1회용 코드를 받아 그 코드를 든 주소로 다시 연다(bootPair). 못 받으면(맥이 늦음·막 받음) false → 그냥 화면,
 *  홈 화면 앱은 그때 '홈 화면 앱 연결'(HomeAppLink) 붙여넣기로 */
const HANDOFF_WAIT_MS = 5000;
async function handoff(): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const late = new Promise<never>((_, no) => { timer = setTimeout(() => no(new Error('late')), HANDOFF_WAIT_MS); });
    const { code } = await Promise.race([newPairCode(), late]);
    location.replace(homeUrl(code));
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

// QR(?pair=)·홈 화면 앱 넘기기(?home=) — 코드를 내고 이 기기 토큰을 받아 저장한다. 사파리면 이어서 홈 화면 앱 몫 코드를 든 주소로 다시 연다
const plan = bootPair({ search: location.search, standalone: isStandalone(), hasToken: hasToken(), tried: homeTried() });
// 코드 든 주소는 주소 줄·공유에서 지운다 — '홈 화면에 추가'의 시작 주소는 처음 읽은 주소로 이미 굳어서 지워도 남는다(시뮬레이터 실측)
if (pairCodeFrom(location.search) || homeCodeFrom(location.search)) history.replaceState(null, '', '/');
if (plan) {
  pair(plan.code, plan.home).then(
    async () => { if (!(plan.handoff && (await handoff()))) show(); },
    (e: unknown) => {
      if (plan.home && spentBy(e)) markHomeTried(plan.code); // 성공하면 열쇠가 있어 다시 안 낸다
      hideBootSplash(); // 첫 그림(모찌)이 덮고 있다 — 못 했다는 말이 보이게
      root.render(<><div className="m-center"><h1>연결 못 했어요</h1><p>{(e as Error).message}</p></div><PairHelp /></>);
    },
  );
} else {
  show();
}
