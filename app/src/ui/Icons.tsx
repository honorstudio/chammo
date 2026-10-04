// 직접 그린 SVG 아이콘 (아이콘 라이브러리 금지 — 프로젝트 원칙 5). 선 굵기·크기를 한 벌로 맞춘다
const P = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

/** 크게: 네 모서리가 바깥으로 */
export const IconMaximize = () => (
  <svg viewBox="0 0 16 16" {...P}><path d="M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10" /></svg>
);
/** 원래대로: 네 모서리가 안으로 */
export const IconRestore = () => (
  <svg viewBox="0 0 16 16" {...P}><path d="M6 2.5V6H2.5M13.5 6H10V2.5M10 13.5V10h3.5M2.5 10H6v3.5" /></svg>
);
/** 접기: 아래로 내려놓는 막대 */
export const IconCollapse = () => (
  <svg viewBox="0 0 16 16" {...P}><path d="M3 12.5h10M8 3v6.5M5 7l3 3 3-3" /></svg>
);
/** 펼치기: 위로 */
export const IconExpand = () => (
  <svg viewBox="0 0 16 16" {...P}><path d="M3 3.5h10M8 13V6.5M5 9l3-3 3 3" /></svg>
);
/** 끄기: 전원 */
export const IconPower = () => (
  <svg viewBox="0 0 16 16" {...P}><path d="M8 2v6M4.6 4.2a5 5 0 1 0 6.8 0" /></svg>
);
/** 이어서: 재생 */
export const IconResume = () => (
  <svg viewBox="0 0 16 16" {...P}><path d="M5 3.2v9.6L12.5 8z" /></svg>
);
/** 대화(컨텍스트) 사용량: 저장소 원통 */
export const IconDb = () => (
  <svg viewBox="0 0 16 16" {...P}><ellipse cx="8" cy="3.8" rx="5" ry="1.8" /><path d="M3 3.8v8.4c0 1 2.2 1.8 5 1.8s5-.8 5-1.8V3.8M3 8c0 1 2.2 1.8 5 1.8s5-.8 5-1.8" /></svg>
);
/** 알림: 종 */
export const IconBell = () => (
  <svg viewBox="0 0 16 16" {...P}><path d="M4 11.5V7.2a4 4 0 0 1 8 0v4.3l1.2 1.3H2.8zM6.5 14a1.6 1.6 0 0 0 3 0" /></svg>
);
/** 세션에 보내기: 종이비행기 */
/** 보내기: 꺾인 화살표(↵) — Enter 와 같은 일(2026-10-02 보내기 버튼 시안 방향 2) */
export const IconEnter = () => (
  <svg viewBox="0 0 16 16" {...P}><path d="M12.6 3.2v4.4a2.1 2.1 0 0 1-2.1 2.1H3.6M6.6 6.6 3.5 9.7l3.1 3.1" /></svg>
);
export const IconSend = () => (
  <svg viewBox="0 0 16 16" {...P}><path d="M14 2 7 9M14 2 9.5 14 7 9 2 6.5z" /></svg>
);
/** 복사: 겹친 두 장 */
export const IconCopy = () => (
  <svg viewBox="0 0 16 16" {...P}><rect x="5.5" y="5.5" width="8" height="8" rx="1.5" /><path d="M10.5 5.5V3.8a1.3 1.3 0 0 0-1.3-1.3H3.8a1.3 1.3 0 0 0-1.3 1.3v5.4a1.3 1.3 0 0 0 1.3 1.3h1.7" /></svg>
);
/** 삭제: 휴지통 */
export const IconTrash = () => (
  <svg viewBox="0 0 16 16" {...P}><path d="M2.5 4.2h11M6.2 4.2V2.8h3.6v1.4M4 4.2l.7 9h6.6l.7-9M6.7 6.8v4M9.3 6.8v4" /></svg>
);
/** 닫기: X */
export const IconClose = () => (
  <svg viewBox="0 0 16 16" {...P}><path d="M4 4l8 8M12 4l-8 8" /></svg>
);
/** 끊기: 45° 로 기운 고리가 두 쪽으로 떨어짐 */
export const IconUnlink = () => (
  <svg viewBox="0 0 16 16" {...P}><path d="M7.3 5.2 9.6 2.9a2.5 2.5 0 0 1 3.5 3.5l-2.3 2.3M8.7 10.8l-2.3 2.3a2.5 2.5 0 0 1-3.5-3.5l2.3-2.3M10.2 10.2l1.6 1.6M5.8 5.8 4.2 4.2" /></svg>
);
/** 저장: 체크 */
export const IconCheck = () => (
  <svg viewBox="0 0 16 16" {...P}><path d="M3 8.5 6.5 12 13 4.5" /></svg>
);
/** 메모: 모서리 접힌 쪽지 + 줄 */
export const IconNote = () => (
  <svg viewBox="0 0 16 16" {...P}><path d="M3 2.5h7l3 3v8H3zM10 2.5v3h3M5.5 8h5M5.5 10.8h3.5" /></svg>
);
/** 열기: 네모 밖으로 나가는 화살표 */
export const IconOpen = () => (
  <svg viewBox="0 0 16 16" {...P}><path d="M9.5 2.5h4v4M13.5 2.5 8 8M12 9.5v3a1 1 0 0 1-1 1H3.5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h3" /></svg>
);
/** 음성 모드: 스피커 + 소리 */
export const IconSpeaker = () => (
  <svg viewBox="0 0 16 16" {...P}><path d="M2.5 6.2h2.3L8 3.5v9L4.8 9.8H2.5zM10.6 5.6a3.4 3.4 0 0 1 0 4.8M12.4 3.8a6 6 0 0 1 0 8.4" /></svg>
);
/** 재생 막대: 멈춤 */
export const IconPause = () => (
  <svg viewBox="0 0 16 16" {...P}><path d="M5.5 3.5v9M10.5 3.5v9" /></svg>
);
/** 재생 막대: 재생 (이어서와 같은 모양 — 이름만 따로) */
export const IconPlay = () => (
  <svg viewBox="0 0 16 16" {...P}><path d="M5 3.2v9.6L12.5 8z" /></svg>
);
/** 하루 전 */
export const IconPrev = () => (
  <svg viewBox="0 0 16 16" {...P}><path d="M10 3.5 5.5 8l4.5 4.5" /></svg>
);
/** 다음 날 */
export const IconNext = () => (
  <svg viewBox="0 0 16 16" {...P}><path d="M6 3.5 10.5 8 6 12.5" /></svg>
);
/** 건너뛰기: 겹친 화살 + 끝 막대 */
export const IconSkip = () => (
  <svg viewBox="0 0 16 16" {...P}><path d="M2.5 4 6.5 8l-4 4M7.5 4l4 4-4 4M13.5 4v8" /></svg>
);
/** 하루 리플레이: 되감는 시계 */
export const IconReplay = () => (
  <svg viewBox="0 0 16 16" {...P}><path d="M2.8 8a5.2 5.2 0 1 0 1.6-3.8M2.5 2.5v2.8h2.8M8 5.2V8l2 1.5" /></svg>
);

/** 리더: 펼친 문서 두 장 */
export const IconReader = () => (
  <svg viewBox="0 0 16 16" {...P}><path d="M2 3.5h4.5a1.5 1.5 0 0 1 1.5 1.5v8a1.5 1.5 0 0 0-1.5-1.5H2Z M14 3.5H9.5A1.5 1.5 0 0 0 8 5v8a1.5 1.5 0 0 1 1.5-1.5H14Z" /></svg>
);


/** 하니터(하네스): 위에서 아래로 쌓이는 층 셋 — 하니터 화면이 글로벌→프로젝트로 쌓아 보여 준다 */
export const IconHarness = () => (
  <svg viewBox="0 0 16 16" {...P}><path d="M8 2.2 14 5 8 7.8 2 5Z M2 8l6 2.8L14 8 M2 11l6 2.8 6-2.8" /></svg>
);
/** 도구: 입 벌린 스패너 하나(MCP·플러그인·스킬) */
export const IconTools = () => (
  <svg viewBox="0 0 16 16" {...P}><path d="M11.73 2.47A3.4 3.4 0 0 0 7.34 7.09L2.82 11.62a1.1 1.1 0 0 0 1.56 1.56L8.91 8.66A3.4 3.4 0 0 0 13.53 4.27L12.26 5.54 10.46 3.74Z" /></svg>
);
/** 사무실: 아이소메트릭 책상 하나 */
export const IconOffice = () => (
  <svg viewBox="0 0 16 16" {...P}><path d="M8 3.5 14 6.5 8 9.5 2 6.5Z M2 6.5v3.5l6 3 6-3V6.5 M8 9.5V13" /></svg>
);
/** 스페이스(대화 화면): 앞뒤로 겹친 말풍선 두 개 — 문서+말풍선은 한눈에 안 읽혔다(2026-09-30 사용자) */
export const IconSpace = () => (
  <svg viewBox="0 0 16 16" {...P}><path d="M2.5 3h7a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1H6L3.5 11V9h-1a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z M10.5 6h3a1 1 0 0 1 1 1v3.5a1 1 0 0 1-1 1h-.5v1.8L10.8 11.5H8.5a1 1 0 0 1-1-1V9" /></svg>
);
/** 채팅 보기: 말풍선 하나 */
export const IconChat = () => (
  <svg viewBox="0 0 16 16" {...P}><path d="M3 3h10a1.2 1.2 0 0 1 1.2 1.2v5.6A1.2 1.2 0 0 1 13 11H7l-3 2.5V11H3a1.2 1.2 0 0 1-1.2-1.2V4.2A1.2 1.2 0 0 1 3 3Z" /></svg>
);
/** 터미널 보기: 네모 안 >_ */
export const IconTerminal = () => (
  <svg viewBox="0 0 16 16" {...P}><rect x="1.8" y="2.8" width="12.4" height="10.4" rx="1.6" /><path d="M4.5 6.3 6.6 8.2 4.5 10.1 M8.2 10.2h3.3" /></svg>
);
/** 파일: 모서리 접힌 종이 */
export const IconFile = () => (
  <svg viewBox="0 0 16 16" {...P}><path d="M4 2h5l3 3v9H4z M9 2v3h3" /></svg>
);
/** 멈추기: 네모 */
export const IconStop = () => (
  <svg viewBox="0 0 16 16" {...P}><rect x="4" y="4" width="8" height="8" rx="1.5" fill="currentColor" /></svg>
);
/** 쌓기: 위아래로 놓인 두 칸 */
export const IconStack = () => (
  <svg viewBox="0 0 16 16" {...P}><rect x="2.5" y="2.5" width="11" height="4.5" rx="1.2" /><rect x="2.5" y="9" width="11" height="4.5" rx="1.2" /></svg>
);
/** 탭: 위에 탭 머리(앞 탭은 본문과 이어짐) + 한 칸 */
export const IconTabs = () => (
  <svg viewBox="0 0 16 16" {...P}><path d="M2.5 13.5V4a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v1.5h5a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1Z M9.5 5.5V4a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v1.5" /></svg>
);
/** 축소: 돋보기 안에 빼기 */
export const IconZoomOut = () => (
  <svg viewBox="0 0 16 16" {...P}><circle cx="7" cy="7" r="4.5" /><path d="M10.4 10.4L14 14M5 7h4" /></svg>
);
/** 확대: 돋보기 안에 더하기 */
export const IconZoomIn = () => (
  <svg viewBox="0 0 16 16" {...P}><circle cx="7" cy="7" r="4.5" /><path d="M10.4 10.4L14 14M5 7h4M7 5v4" /></svg>
);
/** 대시보드: 네 칸 */
export const IconDashboard = () => (
  <svg viewBox="0 0 16 16" {...P}><rect x="2.3" y="2.3" width="4.9" height="4.9" rx="1.2" /><rect x="8.8" y="2.3" width="4.9" height="4.9" rx="1.2" /><rect x="2.3" y="8.8" width="4.9" height="4.9" rx="1.2" /><rect x="8.8" y="8.8" width="4.9" height="4.9" rx="1.2" /></svg>
);
/** 페이지: 접힌 종이에 줄 두 개 */
export const IconPage = () => (
  <svg viewBox="0 0 16 16" {...P}><path d="M4 1.8h5.2L12.5 5v9.2H4Z M9.2 1.8V5h3.3 M6 8.3h4.5 M6 10.8h3.2" /></svg>
);
/** 펼침 화살표(오른쪽) — 펼치면 90도 돌린다 */
export const IconChevron = () => (
  <svg viewBox="0 0 16 16" {...P}><path d="M6 3.8 10.2 8 6 12.2" /></svg>
);
/** 새로고침: 열린 원 + 끝 화살촉 */
export const IconRefresh = () => (
  <svg viewBox="0 0 16 16" {...P}><path d="M12.8 6.2A5 5 0 1 0 13 9.6" /><path d="M13.2 2.8v3.6H9.6" /></svg>
);
/** 더하기 */
export const IconPlus = () => (
  <svg viewBox="0 0 16 16" {...P}><path d="M8 3v10M3 8h10" /></svg>
);
/** 고정: 압정 */
export const IconPin = () => (
  <svg viewBox="0 0 16 16" {...P}><path d="M6 2h4l-.6 4 2.6 2.4H4L6.6 6Z M8 8.4V14" /></svg>
);
/** 고정 풀기: 압정에 사선 */
export const IconPinOff = () => (
  <svg viewBox="0 0 16 16" {...P}><path d="M6 2h4l-.6 4 2.6 2.4H4L6.6 6Z M8 8.4V14 M2.5 2.5l11 11" /></svg>
);
/** 프로젝트: 폴더 */
export const IconFolder = () => (
  <svg viewBox="0 0 16 16" {...P}><path d="M1.8 4.2a1 1 0 0 1 1-1h3.4l1.4 1.6h5.6a1 1 0 0 1 1 1v6.9a1 1 0 0 1-1 1H2.8a1 1 0 0 1-1-1Z" /></svg>
);
/** 내 페이지: 사람 */
export const IconPerson = () => (
  <svg viewBox="0 0 16 16" {...P}><circle cx="8" cy="5.4" r="2.6" /><path d="M3 13.8c.6-2.6 2.6-4 5-4s4.4 1.4 5 4" /></svg>
);
/** 찾기: 돋보기 */
export const IconSearch = () => (
  <svg viewBox="0 0 16 16" {...P}><circle cx="7" cy="7" r="4.5" /><path d="M10.4 10.4L14 14" /></svg>
);
/** 고치기: 연필 */
export const IconPencil = () => (
  <svg viewBox="0 0 16 16" {...P}><path d="M10.6 2.8l2.6 2.6-7.6 7.6-3.3.7.7-3.3zM9.2 4.2l2.6 2.6" /></svg>
);
/** 붙이기: 클립 — 그림·파일 둘 다 */
export const IconClip = () => (
  <svg viewBox="0 0 16 16" {...P}><path d="M13 7.4 7.9 12.5a3.1 3.1 0 0 1-4.4-4.4l5.6-5.6a2.1 2.1 0 0 1 3 3L6.6 11a1.05 1.05 0 0 1-1.5-1.5L10.2 4.4" /></svg>
);
/** 누르고 말하기: 마이크 */
export const IconMic = () => (
  <svg viewBox="0 0 16 16" {...P}><rect x="5.6" y="1.8" width="4.8" height="8" rx="2.4" /><path d="M3.4 7.6a4.6 4.6 0 0 0 9.2 0M8 12.2v2.2" /></svg>
);
/** 더보기: 가로 점 셋 */
export const IconMore = () => (
  <svg viewBox="0 0 16 16" {...P}><circle cx="3.5" cy="8" r=".9" fill="currentColor" /><circle cx="8" cy="8" r=".9" fill="currentColor" /><circle cx="12.5" cy="8" r=".9" fill="currentColor" /></svg>
);
/** 숨기기(내려놓기): 가로 막대 하나 — 창 최소화와 같은 모양 */
export const IconMinimize = () => (
  <svg viewBox="0 0 16 16" {...P}><path d="M3.5 8h9" /></svg>
);
/** 보관함: 뚜껑 덮인 상자 */
export const IconBox = () => (
  <svg viewBox="0 0 16 16" {...P}><path d="M2.5 5.8h11v7.7h-11zM1.8 2.8h12.4v3H1.8zM6.4 8.6h3.2" /></svg>
);
/** 펫: 알 모양 다마고치 + 작은 화면 */
export const IconPet = () => (
  <svg viewBox="0 0 16 16" {...P}><path d="M8 1.8c3 0 5.2 2.9 5.2 6.5S11 14.2 8 14.2 2.8 11.9 2.8 8.3 5 1.8 8 1.8z" /><rect x="5.3" y="5.8" width="5.4" height="4.2" rx=".9" /></svg>
);
/** 숨기기: 감은 눈(가로 곡선 + 속눈썹) — 꺼내 둔 크롬 창을 다시 숨긴다 */
export const IconHide = () => (
  <svg viewBox="0 0 16 16" {...P}><path d="M2 7c1.6 2.2 3.6 3.3 6 3.3S12.4 9.2 14 7M4.2 9.2 3 11M8 10.4V12.6M11.8 9.2 13 11" /></svg>
);
/** 세션들: 겹친 두 칸(뒤 칸은 앞 칸에 가려 모서리만) */
export const IconSessions = () => (
  <svg viewBox="0 0 16 16" {...P}><rect x="2" y="5.5" width="9" height="8" rx="1.4" /><path d="M5 5.5V3.9A1.4 1.4 0 0 1 6.4 2.5h6.2A1.4 1.4 0 0 1 14 3.9v5.2a1.4 1.4 0 0 1-1.4 1.4H11" /></svg>
);
/** 예약: 시계 */
export const IconClock = () => (
  <svg viewBox="0 0 16 16" {...P}><circle cx="8" cy="8" r="5.6" /><path d="M8 4.8V8l2.2 1.4" /></svg>
);
/** 뒤로: 왼쪽 화살표 */
export const IconBack = () => (
  <svg viewBox="0 0 16 16" {...P}><path d="M13 8H3.5M7.3 4.2 3.5 8l3.8 3.8" /></svg>
);
/** 알림 꺼짐: 종에 사선 */
export const IconBellOff = () => (
  <svg viewBox="0 0 16 16" {...P}><path d="M4 11.5V7.2a4 4 0 0 1 6.2-3.3M12 7v4.5l1.2 1.3H2.8M6.5 14a1.6 1.6 0 0 0 3 0M2.5 2.5l11 11" /></svg>
);
