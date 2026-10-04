// 크롬 기능 끄기(맥) — 크롬은 켤 때 자기 앱을 임시 폴더로 복제하고 본체 실행 파일에 하드 링크를 건다(code sign clone, 업데이트 대비).
// 그 link() 가 /Applications 의 크롬 번들을 고치는 걸로 잡혀, 크롬을 띄운 앱(Chammo) 이름으로 '앱 관리' 차단 알림이 떴다
// (2026-10-05 아이맥 QA — tccd: accessing=Google Chrome Beta 본체, responsible=app.chammo.desktop, EPERM 이 5초씩 두 번 = 시작도 늦음).
// 공식 기능 스위치 MacAppCodeSignClone 을 끄면 link 가 0번(아이맥 fs_usage 실측). 업데이트는 구글 업데이터가 자기 이름으로 따로 한다.
//
// 크롬은 --disable-features 를 두 번 받으면 마지막 것만 쓴다(중복 합치기는 크로미움 시험 런처에만 있다) — 플레이라이트가 먼저 넣는
// 자기 끄기 목록이 지워지지 않게 그 목록을 그대로 앞에 둔다. 플레이라이트를 올려 목록이 바뀌면 test/features.test.js 가 깨진다
const PLAYWRIGHT_DISABLED = [
  'AvoidUnnecessaryBeforeUnloadCheckSync', 'DestroyProfileOnBrowserClose', 'DialMediaRouteProvider', 'GlobalMediaControls',
  'HttpsUpgrades', 'LensOverlay', 'MediaRouter', 'PaintHolding', 'ThirdPartyStoragePartitioning',
  'BlockOriginHeaderModificationOnRedirect', 'Translate', 'AutoDeElevate', 'OptimizationHints',
  'msForceBrowserSignIn', 'msEdgeUpdateLaunchServicesPreferredVersion',
];

/** 맥이면 [--disable-features=플레이라이트 목록,MacAppCodeSignClone], 아니면 [] — 플레이라이트가 사용자 인자를 자기 것 뒤에 붙이니 이게 이긴다 */
function featureArgs(platform = process.platform) {
  return platform === 'darwin' ? [`--disable-features=${[...PLAYWRIGHT_DISABLED, 'MacAppCodeSignClone'].join(',')}`] : [];
}

module.exports = { PLAYWRIGHT_DISABLED, featureArgs };
