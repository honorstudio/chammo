// 참모 모드 디자인 키트 — 모드 hooks/ 에 복사해 `import { Chip, Card, … } from './kit'` 로 쓴다(Chammo hq-mode-kit 스킬).
// 모드 호스트는 모르는 속성이 하나라도 있으면 트리를 통째로 버린다(engine) — 그래서 이 함수들은 호스트가 받는 속성만 조합한다.
// Chammo 데스크톱은 그 조합을 보고 앱 모양(알약·카드·구분선·막대)으로 그리고, 터미널은 같은 속성을 그대로 그린다.
// 첫 인자 ui = $.ui.resolve(e) 가 준 요소 묶음. 색(tone)은 success·warning·error·suggestion·inactive·secondary·text, 터미널 색 이름, #hex
/* eslint-disable @typescript-eslint/no-explicit-any */
type UI = { Box: any; Text: any; Button?: any; Markdown?: any }
type Kids = any

/** 칩 — 꽉 찬 알약(숫자·상태). 데스크톱 = 알약, 터미널 = 색 바탕 글 한 줄 */
export const Chip = (ui: UI, text: string, tone = 'suggestion', key?: string) => (
  <ui.Text key={key} backgroundColor={tone} color="inverseText" bold>{` ${text} `}</ui.Text>
)

/** 태그 — 테두리 알약(옅은 강조). 데스크톱 = 테두리 알약, 터미널 = 둥근 상자(세 줄) */
export const Tag = (ui: UI, text: string, tone = 'suggestion', key?: string) => (
  <ui.Box key={key} borderStyle="round" borderColor={tone}><ui.Text color={tone}>{text}</ui.Text></ui.Box>
)

/** 카드 — 둥근 면 + 흐린 선. title 이 있으면 굵은 머리 줄 */
export const Card = (ui: UI, title: string | null, children: Kids, key?: string) => (
  <ui.Box key={key} borderStyle="round" borderDimColor flexDirection="column" paddingX={1} gap={0}>
    {title ? <ui.Text bold>{title}</ui.Text> : null}
    {children}
  </ui.Box>
)

/** 구분선 — 가로 한 줄. width = 터미널에서 몇 칸(데스크톱은 늘 칸 폭) */
export const Divider = (ui: UI, width = 40, key?: string) => (
  <ui.Text key={key} dimColor wrap="truncate">{'─'.repeat(Math.max(3, width))}</ui.Text>
)

/** 격자 — 같은 폭 칸 N열(달력·현황판). 칸마다 정수 % 폭이라 터미널도 같은 줄바꿈(7열 = 14% × 7) */
export const Grid = (ui: UI, columns: number, cells: Kids[], key?: string) => {
  const n = Math.max(1, Math.min(12, Math.round(columns)))
  const w = `${Math.floor(100 / n)}%` // 호스트는 소수 % 를 안 받는다(33.33% → 거절)
  return (
    <ui.Box key={key} flexDirection="row" flexWrap="wrap">
      {cells.map((c, i) => <ui.Box key={`g-${i}`} width={w} flexDirection="column" paddingRight={i % n === n - 1 ? 0 : 1}>{c}</ui.Box>)}
    </ui.Box>
  )
}

/** 진행 막대 — value 0~100. 데스크톱 = 둥근 막대, 터미널 = █░ */
export const Progress = (ui: UI, value: number, tone = 'success', width = 20, key?: string) => {
  const v = Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0))
  const full = Math.round((v / 100) * width)
  return <ui.Text key={key} color={tone}>{'█'.repeat(full) + '░'.repeat(width - full)}</ui.Text>
}

/** 숫자 칸 — 큰 숫자(굵게) + 흐린 라벨(현황판) */
export const Stat = (ui: UI, value: string | number, label: string, tone?: string, key?: string) => (
  <ui.Box key={key} flexDirection="column">
    <ui.Text bold color={tone}>{String(value)}</ui.Text>
    <ui.Text dimColor>{label}</ui.Text>
  </ui.Box>
)

/** 목록 줄 — 종류색 점 + 제목(말줄임) + 오른쪽 흐린 보조 */
export const Row = (ui: UI, title: string, note?: string, tone = 'suggestion', key?: string) => (
  <ui.Box key={key} flexDirection="row" gap={1}>
    <ui.Text color={tone}>●</ui.Text>
    <ui.Box flexGrow={1} flexShrink={1}><ui.Text wrap="truncate">{title}</ui.Text></ui.Box>
    {note ? <ui.Text dimColor>{note}</ui.Text> : null}
  </ui.Box>
)

/**
 * 스킨 고르기 — 단추 줄(고른 것만 꽉 찬 단추). onPick 에서 $.store.set('skin', id) 로 기억하고 다시 그린다.
 * skins 는 kit-svg 의 SKINS(계기판·하늘·표지) 나 모드가 정한 목록. 단추 key = skin-<id>
 */
export const SkinBar = (ui: UI, skins: { id: string; name: string }[], current: string, onPick: (id: string) => void, key = 'skins') => (
  <ui.Box key={key} flexDirection="row" gap={1}>
    {skins.map((s) => <ui.Button key={`skin-${s.id}`} label={s.name} variant={s.id === current ? 'primary' : undefined} onPress={() => onPick(s.id)} />)}
  </ui.Box>
)

/**
 * 뒤로 — 안쪽 화면(날짜 보기·상세처럼 눌러 들어간 화면)에서 나오는 단추. 늘 트리 맨 앞(왼쪽 위)에, 돌아갈 곳 이름을 단다('10월').
 * 칸 머리엔 X 가 없다(칸 끄기는 ⋯ 메뉴) — 안쪽 화면을 만들면 이 단추가 유일한 뒤로 길이다.
 * Chammo 데스크톱·폰은 key mode-back 을 보고 같은 모양(‹ + 이름, 폰 44px)으로 그리고, 폰은 칸 왼쪽 끝에서 밀어도 이 단추를 누른다
 */
export const BackBar = (ui: UI, to: string, onBack: () => void, key = 'mode-back-bar') => (
  <ui.Box key={key} flexDirection="row">
    <ui.Button key="mode-back" label={`뒤로 — ${to}`} onPress={onBack}>{`‹ ${to}`}</ui.Button>
  </ui.Box>
)
