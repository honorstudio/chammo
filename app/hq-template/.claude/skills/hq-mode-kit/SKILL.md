---
name: hq-mode-kit
description: 참모 모드(Chammo 가 그리는 Claude Code 모드)를 새로 만들거나 화면을 다듬을 때 연다 — 호스트가 받는 속성 목록(모르는 속성 하나면 화면이 통째로 사라진다), 앱 디자인으로 그려지는 키트 함수(kit.tsx: Chip·Tag·Card·Divider·Grid·Progress·Stat·Row·SkinBar·BackBar), 폰 칸 점검(kit-phone.ts: 좁은 칸·손가락 44px·그림 속 글·안쪽 화면 뒤로), Svg 큰 장면 키트(kit-svg.ts: 고리·큰 숫자·흐름 막대·점 격자·하늘·등불·스킨 셋 계기판/하늘/표지), 되는 것·안 되는 것, 달력·현황판·할 일·카드 목록·견본 패턴, 웹 방식(Client)을 쓸 때. Design kit for Chammo modes — accepted props, kit functions, phone check (kit-phone.ts), Svg scene kit and skins, what renders, patterns, when to use Client.
---

<!-- Chammo 가 HQ 를 켤 때마다 새로 쓴다 — 고치지 않는다. / Rewritten by Chammo on every start — do not edit. -->

# 한국어

## 먼저 — 이 벽에 박히지 마

**모드 호스트는 모르는 속성이 하나라도 있으면 그 화면(트리)을 통째로 버린다** — 앱엔 모드 그림 대신 '못 그림'만 남는다(호스트 말: `ui.render (Pane) refused: Box prop "variant" is not allowed; the engine drew its own`).
**모르는 값은 그 속성만 빠진다**(`borderStyle="pill"` → 테두리 없이 그려짐). 소수 % 폭(`"33.33%"`)도 거절이다 — 정수 %만.
그래서 새 속성을 지어내지 말고 아래 표의 속성만 쓴다. 앱 모양(알약·카드·구분선·막대)은 **같은 폴더의 `kit.tsx` 함수**가 받는 속성만으로 만들고, Chammo 가 그 조합을 알아보고 앱 디자인으로 그린다.
확인은 `claude plugin test` — 데스크톱 표면에서 거절되면 위 문장이 그대로 나온다.

모드 프로젝트 세션은 이 파일을 못 읽는다 — 일을 보낼 때 **이 파일과 `kit.tsx`·`kit-svg.ts`·`kit-phone.ts` 경로를 메시지에 넣어 "먼저 읽고, kit.tsx·kit-svg.ts·kit-phone.ts 를 hooks/ 에 복사하고, 폰 칸 점검 시험(phone.test.tsx)까지 통과시켜"** 라고 한다
(`<HQ 폴더>/.claude/skills/hq-mode-kit/SKILL.md`, `…/kit.tsx`, `…/kit-svg.ts`, `…/kit-phone.ts`).

## 호스트가 받는 속성(2.1.296 실측)

| 요소 | 받는 속성 | 거절(트리째 버림) |
|---|---|---|
| Box 배치 | `flexDirection` `flexWrap` `alignItems` `justifyContent` `alignSelf` `flexGrow` `flexShrink` `gap` `columnGap` `rowGap` `display` `position` `key` | `flexBasis` |
| Box 크기 | `width` `height` `minWidth` `minHeight` — 숫자 또는 **정수** % | `maxWidth` `maxHeight`, 소수 % |
| Box 여백 | `padding` `paddingX/Y` `paddingTop/Bottom/Left/Right` `margin` `marginX/Y` `marginTop/Bottom/Left/Right` | |
| Box 모양 | `borderStyle`(single·round·double·bold·classic·arrow·singleDouble — 모르는 값은 빠짐) `borderColor` `borderDimColor` `backgroundColor` `overflow` | `borderTop`·`borderLeft` 같은 한 변, `borderTopColor`, `overflowX/Y` |
| Text | `bold` `dimColor` `italic` `underline` `strikethrough` `inverse` `color` `backgroundColor` `wrap`(wrap·truncate·truncate-middle·truncate-end) | `size` 같은 글자 크기 |
| 둘 다 | | 지어낸 이름 전부 — `variant` `tone` `data-*` `aria-*` |

색 이름: `success` `warning` `error` `suggestion`(파랑) `inactive`(흐림) `secondary`(중간 회색) `text` `inverseText`, 터미널 색 이름(`red` `blue`…), `#hex`. 다크 모드는 앱이 맞춘다.
흐린 글(`dimColor`·`inactive`·`subtle`·`gray`)은 라이트·다크 모두 흰·회색 칸에서 4.5:1 이상으로 그려진다 — 글을 흐리게 하려고 `#hex` 회색을 직접 쓰지 않는다(다크 모드를 못 따라간다).

**앱 테마 알기** — 그리기 요청마다 `e.props.scheme` 에 지금 테마(`'light'`|`'dark'`)가 온다(데스크톱은 앱 테마, 폰은 폰 화면 테마). 바뀌면 앱이 다시 그리게 한다. 색 이름 밖의 브랜드 색을 Text·Box 에 쓸 땐 이 값으로 고른다 —
`const dark = (e.props as { scheme?: string }).scheme === 'dark'` · `color={dark ? '#ff5a5f' : '#c8102e'}`. 값이 없으면(옛 앱·시험 엔진) 라이트로 본다.

## 크기 단위

- 가로(width·minWidth·gap·paddingX) = 글자 칸 1 = 8px
- 세로 크기(height·minHeight) = 줄 1 = 18px — `e.viewport.rows`(칸 줄 수)와 같은 단위. 세로 여백(paddingY·margin·rowGap) 1 = 4px
- 높이를 정한 Box 는 넘친 줄을 **잘라 버린다**. 다 보이게 하려면 높이를 주지 말거나 내용 줄 수만큼. 칸 본문은 세로로 스크롤된다

## 잠들기 — keepAlive

모드 호스트는 하나에 ≈240MB 다(가벼운 모드끼리는 하나를 같이 쓴다 — 아래). `.claude-plugin/chammo.json` 에 `"keepAlive": true` 를 안 적은 모드는 **어느 칸에도 안 보인 지 5분이면 잠들고**(호스트를 끈다) 다시 보이면 깨어난다 — 그 사이 모드 안 메모리 상태는 잃으니 남길 것은 `$.store` 에. 화면이 안 보여도 뒤에서 계속 돌아야 하는 모드(타이머·감시·알림)만 `keepAlive: true` 를 적는다.

## AI 안 쓰면 가볍게 도는 법

달력·현황판·할 일처럼 모델을 안 부르는 모드는 `$.clock`·`$.env`·`$.fs`·`$.store`·`$.ui` 만 쓴다 — 모델 비용은 0 이고 CPU 는 가만히 0~2% 다. 이런 모드는 `.claude-plugin/chammo.json` 에 **`"light": true`** 를 적는다 — 그러면 앱이 선언한 모드끼리 호스트 하나를 같이 쓴다(맛보기 넷 따로 ≈970MB → 하나 ≈242MB). 안 적으면 지금처럼 자기 호스트. 적었어도 앱이 글을 보고 자기 호스트로 돌리는 때(host.log 에 까닭 한 줄): 위 다섯 밖 `$.` 이름(`$.model`·`$.agent`·`$.process`·`$.http` 등)이나 `$[…]` 가 보일 때, 칸 id 를 글로 못 읽을 때(`$.ui.open({ id: 'x' })` 또는 `const ID = 'x'` 꼴로 — 틀(`` `p${n}` ``)·함수 결과는 못 읽는다), 칸 id·plugin.json 이름이 먼저 올라간 가벼운 모드와 겹칠 때(겹친 칸은 호스트가 소리 없이 빼서). 같이 쓰는 대가: 한 모드가 호스트를 죽이면 같이 멈추고(다시 켜기로 다 같이 산다), 작업 폴더(`<데이터>/modes/.light/run`)가 하나라 자기 run 폴더에 쓰는 파일은 섞인다 — 남길 것은 `$.store` 에. 더 가볍게: ① `keepAlive` 를 적지 않는다 — 앱을 켤 때 아무 칸에도 안 보이면 호스트를 아예 안 띄우고, 보이면 그때 깨운다 ② 깨어날 때 다시 그릴 수 있게 상태는 `$.store`·파일에만 두고 모듈 변수는 캐시로만 ③ `$.clock.every` 는 화면이 바뀌는 만큼만(달력은 1분, 초 단위 타이머 금지) ④ 큰 파일은 그릴 때마다 통째로 읽지 말고 필요한 꼬리만.

## 카드 그림 — card

고르기 시트 카드 그림은 `.claude-plugin/chammo.json` 의 `"card"` 로 정한다 — 모드 폴더 안 그림 경로(`"card": "card.svg"`·png·jpg·webp, 512KB 까지) 또는 Svg 글 그대로. 앱이 Svg 를 거른 뒤(스크립트·바깥 주소는 버림) 카드 비율에 꽉 채워(cover) 그린다. 안 적으면 그 모드가 마지막으로 그려진 칸을 작게 줄여 보여 주고, 아직 안 그려졌으면 자리표시.

## 키트 — `kit.tsx`

`hooks/` 에 복사하고 `import { Chip, Card, … } from './kit'`. 첫 인자는 `const ui = $.ui.resolve(e)`.

| 함수 | 만드는 것(받는 속성) | 데스크톱(Chammo) | 터미널 |
|---|---|---|---|
| `Chip(ui, '끝 5', 'success')` | `backgroundColor` 가 있는 Text | 꽉 찬 알약 | 색 바탕 글 |
| `Tag(ui, '대기', 'warning')` | `borderStyle="round"` 상자 안 Text 하나 | 테두리 알약 | 둥근 상자(세 줄) |
| `Card(ui, '머리', [자식…])` | `borderStyle="round" borderDimColor` 상자 | 둥근 면·흐린 선 | 흐린 둥근 상자 |
| `Divider(ui, 40)` | `─` 만 든 Text | 1px 가로선 | ─ 줄 |
| `Grid(ui, 7, [칸…])` | 줄바꿈 Box + 칸마다 정수 % 폭 | 같은 폭 N열(7열 = 14%×7) | 같은 줄바꿈 |
| `Progress(ui, 60, 'success')` | `█`·`░` 만 든 Text | 둥근 진행 막대(채운 비율 = █ 비율) | █░ 막대 |
| `Stat(ui, 12, '진행 중', 'suggestion')` | 굵은 숫자 Text + 흐린 라벨 Text | 그대로 | 그대로 |
| `Row(ui, '제목', '내일', 'warning')` | ● 점 Text + 제목(말줄임) + 흐린 보조 | 그대로 | 그대로 |
| `SkinBar(ui, SKINS, 'gauge', onPick)` | Button 줄(key `skin-<id>`, 고른 것 variant primary) | 단추 줄 | 단추 줄 |
| `BackBar(ui, '10월', onBack)` | Box 안 Button 하나(key `mode-back`, label `뒤로 — 10월`, 글 `‹ 10월`) | 앱이 같은 모양 ‹ 단추로(폰 44px), 폰은 칸 왼쪽 끝 밀기도 이것 | ‹ 10월 |

키에 `key` 를 넘길 수 있다(마지막 인자). 위 조합을 손으로 써도 같은 모양이 나온다 — 키트는 그 조합을 줄여 쓰는 것뿐이다.

## 폰 칸 점검 — 모드를 만들면 늘

폰 앱은 같은 모드를 좁은 칸에 그린다 — 홈 카드 **41×28**, 꽉 채워 보기 **46×40**(글자 칸×줄, 앱이 모드에 주는 값 그대로). 데스크톱만 보고 만들면 폰에서 넘치고, 그림 속 글이 작아지고, 단추가 손가락에 안 맞는다.
같은 폴더 `kit-phone.ts` 를 `hooks/` 에 복사하고 시험 파일(`phone.test.tsx`)에 넣는다 — 데스크톱 표면·스킨마다·두 크기에서 문제 목록이 `[]` 여야 한다:

```tsx
import { PHONE, phoneCheck } from './kit-phone'
for (const [where, size] of Object.entries(PHONE)) test(`폰 ${where}`, async ($, on) => {
  const ui = await $.ui.mount({ plugin: '<이름>', surface: 'desktop', component: 'Pane', requestId: '<id>', props: {} as never, viewport: { ...size, isFullscreen: true } })
  expect(phoneCheck(await ui.drawn(), size)).toEqual([])
})
```

잡는 것: ① 칸보다 넓은 고정 폭(`width` > 칸) ② 한 줄에 안 들어가는 단추 줄(단추 하나 = 글 + 2칸, 적어도 손가락 44px = 6칸 — `flexWrap="wrap"` 이나 줄 나누기로) ③ label 없는 단추(‹·□ 같은 기호만 든 단추도 읽을 이름) ④ 칸 폭에 맞춰 줄어든 Svg 속 가장 작은 글이 11px 아래(그림 글은 11px 이상으로) ⑤ **안쪽 화면**(날짜 보기·상세처럼 눌러 들어간 화면)이면 `phoneCheck(tree, size, { inner: true })` — `BackBar` 가 맨 앞에 있어야 한다.
세로는 칸이 길게 스크롤되니 높이를 정해 자르지 말고(`height` 를 주면 넘친 줄이 잘린다) 내용만큼.

## 안쪽 화면과 뒤로 — 칸 머리엔 X 가 없다

모드 안에서 눌러 들어가는 화면(달력 날짜 보기·목록 → 상세)을 만들면 **`BackBar(ui, '<돌아갈 곳>', onBack)` 를 트리 맨 앞(왼쪽 위)** 에 둔다. 앱 칸 머리엔 뒤로가 없고, 칸 끄기는 머리 ⋯ 메뉴 안에 있다 —
그래서 이 단추가 사람이 쓰는 유일한 뒤로다(날짜 보기에서 뒤로 가려고 X 를 눌러 칸이 꺼지던 일이 있었다). 앱은 key `mode-back` 을 보고 모든 모드에서 같은 모양으로 그리고, 폰은 칸 왼쪽 끝에서 오른쪽으로 밀면 이 단추를 누른다.
첫 화면에선 두지 않는다. 고르기(선택 표시)는 안쪽 화면이 아니다 — 화면이 바뀌어 원래 화면으로 돌아갈 길이 필요할 때만.

## 되는 것·안 되는 것

| 하고 싶은 것 | 지금 | 대신 |
|---|---|---|
| 꽉 찬 알약·테두리 알약 | 됨 — `Chip`·`Tag` | |
| 배경색 면·카드 | 됨 — `backgroundColor`·`Card` | |
| 줄마다 다른 높이 | 됨 — 자연 높이 또는 `height` 줄 수 | |
| 같은 폭 격자 | 됨 — `Grid`(정수 %) | 3열은 33%×3 = 99%(끝 1% 빔) |
| 진행 막대 | 됨 — `Progress` | |
| 글자 크기 단계(큰 숫자·제목) | Box/Text 는 **안 됨** — 호스트가 `size` 를 거절 | Svg 안에선 됨 — `BigNum`(아래 견본 패턴) |
| 왼쪽·오른쪽 한 변 테두리(색 띠) | **안 됨**(호스트도 앱도 막음) | 옅은 면·점(`Row`)·사방 테두리 |
| 위·아래 한 줄만 테두리 | 안 됨 | `Divider` |
| maxWidth·maxHeight·안쪽 따로 스크롤 | 안 됨 | 칸 본문이 통째로 스크롤된다 |
| 그림(png·jpg) | 안 됨 | Svg(거른 뒤 그림으로만) |
| Svg 안 움직임 | `<style>` @keyframes 는 거름을 통과, SMIL(`<animate>`)·스크립트는 걸러진다 | CSS 애니메이션 |
| 글꼴·그림자·그라데이션 | Box/Text 는 안 됨 | Svg 안에선 됨(맥 시스템 글꼴만 — 앱 웹폰트는 못 씀) |

## 패턴

**달력** — 요일 머리와 날짜를 `Grid(ui, 7, …)` 로, 오늘은 `Chip`, 일정은 `Tag`:

```tsx
const ui = $.ui.resolve(e)
const cells = [...WEEK.map((w) => <ui.Text key={w} dimColor>{w}</ui.Text>),
  ...days.map((d) => <ui.Box key={d.n} flexDirection="column" minHeight={3}>
    {d.today ? Chip(ui, String(d.n), 'suggestion') : <ui.Text>{String(d.n)}</ui.Text>}
    {d.events.slice(0, 2).map((ev) => Tag(ui, ev.title, 'suggestion', ev.id))}
  </ui.Box>)]
return Grid(ui, 7, cells)
```

**현황판** — `Grid` 안에 `Card` + `Stat`, 아래 `Progress`:

```tsx
Grid(ui, 3, [Card(ui, null, Stat(ui, 12, '진행 중', 'suggestion')), Card(ui, null, Stat(ui, 5, '끝', 'success')), Card(ui, null, Stat(ui, 1, '정할 것', 'warning'))])
Progress(ui, 84, 'success')
```

**할 일 목록** — `Card` 머리에 `Chip`(남은 수), 줄은 `Row` 나 단추 + 글, 묶음 사이 `Divider`.
**카드 목록** — 세로 Box(gap 1)에 `Card` 여러 개, 카드 머리 줄에 `Chip`·`Tag`.
앱 안 맛보기(달력·현황판·할 일·참모 상태)가 이 키트로 그려져 있다 — `<데이터 폴더>/modes/.examples/<이름>/hooks/`.

## 견본 패턴·스킨 — Svg 큰 장면 + 키트로 누르기

앱 안 맛보기(달력·현황판·할 일·참모 상태)는 **위에 Svg 큰 장면, 아래에 키트로 누르는 것**으로 짜여 있고, 데스크톱에선 오른쪽 위 단추로 **스킨 셋**을 바꾼다 —
계기판(숫자·고리·점) · 하늘(이 시각 하늘·해·달·별·등불) · 표지(큰 세리프·활자·여백). 고른 스킨은 `$.store` 에 남고, 바꿀 때 겹쳐 사라진다.

`<Svg source={…} alt="…"/>` 는 앱에서 **그림(<img>)** 으로 그려진다 — 누를 수 없고, 대신 글자 크기·그라데이션·흐림·`<style>` @keyframes·다크 모드(`@media (prefers-color-scheme: dark)` — 맥 설정이 아니라 **앱 테마**(데스크톱 테마 메뉴·폰 화면)를 따른다: 앱이 그릴 때 그 조건을 지금 테마로 바꿔 넣고, 테마가 바뀌면 다시 그린다)가 다 된다.
글은 `kit-svg.ts` 함수(전부 Svg 글 조각을 돌려줌)로 짠다:

| 함수 | 만드는 것 |
|---|---|
| `svgDoc({ layers, maxH })` | 조각을 스킨 층으로 감싼 Svg 한 장(루트 `class="mode-anim"`, `<style>` 한 블록). maxH 보다 크면 같은 비율로 줄임 |
| `Label` · `BigNum` · `Pill` | 글 한 줄 · 큰 숫자/제목(`font:'serif'` = Didot 계열, `fill: paint(skin,'acc')` = 그라데이션) · 떠 있는 이름표 |
| `Ring` · `RingNote` | 고리(채운 몫·옅은 구간·눈금·하루 한 바퀴 도는 바늘) · 고리 위 작은 글 |
| `Flow` · `Spark` · `Dots` | 세로 캡슐 막대(지금 칸에 위로 흐르는 빛) · 작은 선 그래프 · 7줄 점 격자(오늘 숨쉬기·고른 칸 고리 + 이름표) |
| `Sky` · `Lamps` | 시각대로 하늘(실제 자리 해, 밤엔 달 모양·반짝이는 별, 흐르는 구름, 언덕·길) · 길 위 등불(켜짐·꺼짐·빈 등·따뜻한 불) |
| `InkCircle` · `Rule` | 한 번 그려지는 손그림 고리 · 가로 줄 |
| `sunTimes` · `moonAge` · `moonName` · `hm` · `textW` | 서울 해 뜸·짐(분) · 달 나이 · 달 이름 · 9:05 꼴 · 글 폭 어림 |
| `SKINS` · `skinOf` · `skinSwap` | 스킨 셋 · 저장 값 → 스킨(모르면 기본) · 바꿀 때 겹쳐 사라지기 |
| `SkinBar(ui, SKINS, 지금, onPick)`(kit.tsx) | 스킨 단추 줄(key `skin-<id>`, 고른 것 primary) |

```tsx
const swap = skinSwap()
async function pickSkin($: EngineInterface, id: string) {
  swap.pick(); await $.store.set('skin', id)
  setTimeout(() => { if (swap.done()) void $.ui.invalidate('ui.render') }, 650) // 전환 뒤 한 겹으로
  await $.ui.invalidate('ui.render')
}
// ui.render 안(데스크톱):
const skin = skinOf(await $.store.get('skin'))
const W = columns * 8, maxH = rows * 18 - 112          // 칸 폭 px · 위아래 단추 줄 남긴 높이
const layer = { skin, w: W, h: 300, body: Ring(150, 150, 110, { value: 0.6, hand: true }) + BigNum(150, 172, '12', { size: 84, anchor: 'middle' }) }
return <Box flexDirection="column" gap={2}>
  <Box flexDirection="row" justifyContent="flex-end">{SkinBar(ui, SKINS, skin, (id) => void pickSkin($, id))}</Box>
  <Svg source={svgDoc({ layers: swap.layers(layer), maxH }).svg} alt="…" />
  {/* 아래 = 키트로 누르는 것(단추·목록·입력) */}
</Box>
```

- **움직임 약속** — 루트 `class="mode-anim"`, 움직임은 `<style>` 한 블록의 @keyframes 에만, 움직임을 다 빼도 그림이 그 순간 그대로 보이게(바늘은 바깥 g 가 지금 각도, 그려지기는 `both`, 사라지는 층은 기본 투명). 앱은 사람이 안 볼 때·부하 때 움직임을 뺀 정지판으로 바꿔 그린다
- **움직임은 아껴** — `<img>` 안 움직임은 점 하나라도 그림 전체를 매 프레임 다시 그린다(1064px 한 장, 렌더러 10%·GPU 12% 실측, 정지판은 3%·2%). 한 장면에 숨쉬는 것 한두 개
- **시간** — 모드 안 `setTimeout` 이 돈다. 견본은 10분마다 다시 그리고 그 사이 초·분 흐름은 CSS(바늘 86400초 한 바퀴)
- **터미널** — `e.surface !== 'desktop'` 이면 Svg 대신 키트(글)로. 터미널은 Svg 를 못 그린다
- **이름** — 그라데이션은 `paint(skin, 'acc'|'v'|'shine'|'glow')`(스킨 접두라 두 층이 안 겹친다), 색은 스킨 CSS 변수(`var(--ink)`·`--dim`·`--line`·`--a1`·`--warm`·`--red`)를 class 나 `style="fill:var(…)"` 로(견본은 칠 속성 `fill="var(…)"` 를 안 쓴다)
- **여럿을 한 장에** — 참모 상태처럼 캐릭터·장면 조각이 여럿이면 Svg 를 여러 장 두지 말고 한 장에(움직이는 그림이 여럿이면 그만큼 다시 그린다). 조각마다의 CSS 는 제 접두(`.k-ch` 등) 아래로 묶어 층 `css` 로 넘기면 `<style>` 한 블록에 한 번씩 들어간다
- **기본 모드는 읽기만** — 앱 맛보기는 공개판 사용자 맥 전부에서 돈다: `$.process.run`·대화 기록(`~/.claude/projects`) 금지(앱 시험이 막는다). 세션 상태는 앱이 `<데이터>/live.json` 세션마다 쓰는 `state`(work·wait·ask·idle·unknown)를 읽는다
- **함정** — 모드 모듈은 `$`·`on` 이름을 지역 변수로 다시 쓰거나(`const on = …`) `$` 를 값으로 넘기면(`Object.keys($)`) 안 불린다. 모듈 상태(고른 날 등)는 같은 시험 파일 안 시험끼리 이어진다 — 시험 끝에 되돌려 둔다. `mock.store` 는 한 시험에 한 번. Svg 글엔 늘 `.k-leave` CSS 가 들어 있다 — 층 확인은 `class="k-<스킨> k-leave"` 로

## 웹 방식(Client) — 언제

디자인을 완전히 마음대로 해야 할 때(위 속성으로 안 되는 배치, 자주 바뀌는 상태). `<Client module="./board.tsx" key="b1" props={{…}} />` —
모듈은 앱 안 **안 보이는 방(샌드박스 iframe)** 에서 돌고, 방이 보낸 트리를 앱 렌더러가 그린다(위 표·키트 모양은 Client 안에서도 같다, Svg 는 빼고).
- 데이터는 **props 로만** 넘긴다. 방 안엔 네트워크가 없다(fetch·외부 불러오기 막힘) — 모드 훅이 읽어서 props 로
- 누름은 모드로 돌아간다(`ui_client_press`), 방에서 모드로 글은 `surface.post`
- 먼저 Box/Text·키트로 해 보고, 안 될 때만 Client

# English

## First — don't hit this wall

**The mode host throws away the whole screen (tree) if it has even one unknown prop** — the app shows "can't draw" instead (host message: `ui.render (Pane) refused: Box prop "variant" is not allowed; the engine drew its own`).
**An unknown value only drops that prop** (`borderStyle="pill"` → drawn without a border). Fractional percent widths (`"33.33%"`) are refused too — whole percents only.
So never invent props; use only the props in the table below. App looks (pills, cards, dividers, bars) come from the **`kit.tsx` functions in this folder**, built from accepted props only — Chammo recognizes those combinations and draws them in the app's design.
Check with `claude plugin test` — a refusal on the desktop surface prints the sentence above.

The mode project's session can't read this file — when you send it work, **put the paths of this file, `kit.tsx`, `kit-svg.ts` and `kit-phone.ts` in the message and say "read it first, copy kit.tsx, kit-svg.ts and kit-phone.ts into hooks/, and make the phone check test (phone.test.tsx) pass"**
(`<HQ folder>/.claude/skills/hq-mode-kit/SKILL.md`, `…/kit.tsx`, `…/kit-svg.ts`, `…/kit-phone.ts`).

## Props the host accepts (measured on 2.1.296)

| Element | Accepted | Refused (whole tree dropped) |
|---|---|---|
| Box layout | `flexDirection` `flexWrap` `alignItems` `justifyContent` `alignSelf` `flexGrow` `flexShrink` `gap` `columnGap` `rowGap` `display` `position` `key` | `flexBasis` |
| Box size | `width` `height` `minWidth` `minHeight` — a number or a **whole** percent | `maxWidth` `maxHeight`, fractional % |
| Box spacing | `padding` `paddingX/Y` `paddingTop/Bottom/Left/Right` `margin` `marginX/Y` `marginTop/Bottom/Left/Right` | |
| Box look | `borderStyle` (single, round, double, bold, classic, arrow, singleDouble — unknown values dropped) `borderColor` `borderDimColor` `backgroundColor` `overflow` | single sides like `borderTop`/`borderLeft`, `borderTopColor`, `overflowX/Y` |
| Text | `bold` `dimColor` `italic` `underline` `strikethrough` `inverse` `color` `backgroundColor` `wrap` (wrap, truncate, truncate-middle, truncate-end) | font sizes like `size` |
| Both | | any invented name — `variant` `tone` `data-*` `aria-*` |

Color names: `success` `warning` `error` `suggestion` (blue) `inactive` (dim) `secondary` (mid gray) `text` `inverseText`, terminal color names (`red`, `blue`…), `#hex`. Dark mode follows the app.
Dim text (`dimColor`, `inactive`, `subtle`, `gray`) is drawn at 4.5:1 or more on white and gray panes in both light and dark — don't dim text with a `#hex` gray yourself (it won't follow dark mode).

**Knowing the app theme** — every render request carries the current theme in `e.props.scheme` (`'light'`|`'dark'`; the app theme on desktop, the phone's screen theme on the phone). When it changes, the app asks for a fresh render. For brand colors outside the color names on Text/Box, pick by it —
`const dark = (e.props as { scheme?: string }).scheme === 'dark'` · `color={dark ? '#ff5a5f' : '#c8102e'}`. If it's missing (older app, test engine), treat it as light.

## Units

- Horizontal (width, minWidth, gap, paddingX) = 1 cell = 8px
- Vertical size (height, minHeight) = 1 line = 18px — the same unit as `e.viewport.rows`. Vertical spacing (paddingY, margin, rowGap) 1 = 4px
- A Box with a height **clips** overflowing lines. To show everything, give no height or as many lines as the content. The pane body scrolls vertically

## Sleeping — keepAlive

Each mode host is ≈240MB (light modes share one — below). A mode without `"keepAlive": true` in `.claude-plugin/chammo.json` **falls asleep after 5 minutes on no screen** (the host is stopped) and wakes when shown again — in-memory state is lost meanwhile, so keep what matters in `$.store`. Write `keepAlive: true` only for modes that must keep running off screen (timers, watchers, alerts).

## Staying light without AI

Modes that never call the model (calendar, board, to-do) use only `$.clock`, `$.env`, `$.fs`, `$.store` and `$.ui` — model cost is zero and idle CPU stays around 0–2%. Write **`"light": true`** in `.claude-plugin/chammo.json` for such a mode — the app then runs the declared modes on one shared host (the four samples apart ≈970MB → shared ≈242MB). Without it the mode keeps its own host. Even when declared, the app reads the code and gives the mode its own host (one line in host.log) when it sees a `$.` name outside those five (`$.model`, `$.agent`, `$.process`, `$.http`…) or `$[…]`, when a pane id can't be read from the text (write `$.ui.open({ id: 'x' })` or `const ID = 'x'` — template strings and function results can't be read), or when a pane id or plugin.json name clashes with a light mode already on the host (the host silently drops a clashing pane). The cost of sharing: if one mode kills the host the others stop too (restarting brings them all back), and the working folder (`<data>/modes/.light/run`) is shared, so files a mode writes to its run folder mix — keep what matters in `$.store`. To stay lighter: ① leave out `keepAlive` — if no pane shows the mode when the app starts, the host isn't started at all and wakes when shown ② keep state in `$.store` or files so a woken mode can redraw; module variables are only a cache ③ run `$.clock.every` only as often as the screen changes (a minute for a calendar, no per-second timers) ④ don't reread a big file on every render — read just the tail you need.

## Card picture — card

The picker card's picture comes from `"card"` in `.claude-plugin/chammo.json` — a picture path inside the mode folder (`"card": "card.svg"`, png, jpg, webp, up to 512KB) or SVG text. The app filters SVG (scripts and outside addresses are dropped) and fills the card (cover). Without it the card shows a small copy of the mode's last drawn pane, or a placeholder if it hasn't drawn yet.

## Kit — `kit.tsx`

Copy it into `hooks/` and `import { Chip, Card, … } from './kit'`. The first argument is `const ui = $.ui.resolve(e)`.

| Function | Builds (accepted props) | Desktop (Chammo) | Terminal |
|---|---|---|---|
| `Chip(ui, 'Done 5', 'success')` | Text with `backgroundColor` | solid pill | colored text |
| `Tag(ui, 'Waiting', 'warning')` | a `borderStyle="round"` box holding one Text | outlined pill | round box (3 lines) |
| `Card(ui, 'Head', [children…])` | `borderStyle="round" borderDimColor` box | rounded surface, light line | dim round box |
| `Divider(ui, 40)` | Text of only `─` | 1px rule | ─ line |
| `Grid(ui, 7, [cells…])` | wrapping Box + whole-% width per cell | N equal columns (7 = 14%×7) | same wrapping |
| `Progress(ui, 60, 'success')` | Text of only `█` and `░` | rounded progress bar (fill = share of █) | █░ bar |
| `Stat(ui, 12, 'In progress', 'suggestion')` | bold number Text + dim label Text | as is | as is |
| `Row(ui, 'Title', 'Tomorrow', 'warning')` | ● dot Text + title (truncates) + dim note | as is | as is |
| `SkinBar(ui, SKINS, 'gauge', onPick)` | a row of Buttons (key `skin-<id>`, current one variant primary) | button row | button row |
| `BackBar(ui, 'October', onBack)` | one Button in a Box (key `mode-back`, label `뒤로 — October`, text `‹ October`) | the app draws it as the standard ‹ button (44px on the phone); a swipe from the left edge on the phone presses it | ‹ October |

Each takes an optional `key` as its last argument. Writing those combinations by hand gives the same look — the kit is just shorthand.

## Phone check — always, when you build a mode

The phone app draws the same mode in a narrow slot — home card **41×28**, full view **46×40** (columns × rows, exactly what the app gives the mode). Built for the desktop only, it overflows on the phone, text inside pictures shrinks and buttons miss fingers.
Copy `kit-phone.ts` from this folder into `hooks/` and add it to a test file (`phone.test.tsx`) — on the desktop surface, for every skin and both sizes the problem list must be `[]`:

```tsx
import { PHONE, phoneCheck } from './kit-phone'
for (const [where, size] of Object.entries(PHONE)) test(`phone ${where}`, async ($, on) => {
  const ui = await $.ui.mount({ plugin: '<name>', surface: 'desktop', component: 'Pane', requestId: '<id>', props: {} as never, viewport: { ...size, isFullscreen: true } })
  expect(phoneCheck(await ui.drawn(), size)).toEqual([])
})
```

It catches: (1) fixed widths wider than the slot (2) button rows that don't fit one line (a button = its text + 2 columns, at least a 44px finger = 6 columns — use `flexWrap="wrap"` or split the row) (3) buttons without a label (symbol-only buttons like ‹ or □ need a readable name) (4) the smallest text in an Svg, after it shrinks to the slot width, under 11px (5) on an **inner screen** (a day view or a detail you tap into) `phoneCheck(tree, size, { inner: true })` — `BackBar` must come first.
Vertically the slot scrolls, so don't clip with a fixed `height` — let it be as tall as the content.

## Inner screens and back — there is no X on the slot header

When a mode has a screen you tap into (a calendar day view, list → detail), put **`BackBar(ui, '<where back goes>', onBack)` first in the tree (top left)**. The app's slot header has no back, and turning the slot off lives in the header's ⋯ menu —
so this button is the only way back. The app spots key `mode-back` and draws it the same way in every mode; on the phone, swiping right from the slot's left edge presses it.
Leave it off the first screen. Selecting something is not an inner screen — only when the view changes and there has to be a way back.

## What renders

| Want | Now | Instead |
|---|---|---|
| Solid and outlined pills | yes — `Chip`, `Tag` | |
| Filled areas, cards | yes — `backgroundColor`, `Card` | |
| Different row heights | yes — natural height or `height` in lines | |
| Equal-width grid | yes — `Grid` (whole %) | 3 columns = 33%×3 = 99% |
| Progress bar | yes — `Progress` | |
| Text sizes (big numbers, titles) | **no** in Box/Text — the host refuses `size` | yes inside Svg — `BigNum` (showcase patterns below) |
| One-side left/right border (color stripe) | **no** (host and app both block it) | light fill, dot (`Row`), full border |
| Top/bottom-only border | no | `Divider` |
| maxWidth, maxHeight, inner scroll areas | no | the whole pane body scrolls |
| Raster images (png, jpg) | no | Svg (filtered, drawn as an image) |
| Motion inside Svg | `<style>` @keyframes passes the filter; SMIL (`<animate>`) and scripts are filtered out | CSS animation |
| Fonts, shadows, gradients | no in Box/Text | yes inside Svg (system fonts only — not the app's web fonts) |

## Patterns

**Calendar** — weekday heads and dates in `Grid(ui, 7, …)`, today as a `Chip`, events as `Tag`s (see the Korean example above — the code is the same).
**Board** — `Card` + `Stat` inside a `Grid`, a `Progress` below. **To-do list** — a `Chip` (count left) in the `Card` head, rows as `Row` or a button + text, `Divider` between groups.
**Card list** — a column Box (gap 1) of `Card`s with `Chip`/`Tag` in the head row. The app's try-out modes (calendar, board, to-do, team) are drawn with this kit — `<data folder>/modes/.examples/<name>/hooks/`.

## Showcase patterns & skins — a big Svg scene + kit to press

The app's try-out modes (calendar, board, to-do, team) are laid out as **a big Svg scene on top and kit controls to press below**, and on desktop a button row at the
top right switches between **three skins** — gauge (numbers, rings, dots) · sky (the sky right now: sun, moon, stars, lanterns) · cover (big serif, type, white space).
The chosen skin is kept in `$.store` and the switch cross-fades.

`<Svg source={…} alt="…"/>` is drawn by the app as an **image (<img>)** — it can't be pressed, but font sizes, gradients, blur, `<style>` @keyframes and dark mode
(`@media (prefers-color-scheme: dark)` — follows the **app theme** (desktop theme menu, phone screen), not the Mac setting: the app rewrites that condition to the current theme when it draws and redraws when the theme changes) all work. Write it with the `kit-svg.ts` functions (each returns a piece of Svg text):

| Function | Makes |
|---|---|
| `svgDoc({ layers, maxH })` | one Svg from skin layers (root `class="mode-anim"`, one `<style>` block), scaled down to maxH |
| `Label` · `BigNum` · `Pill` | a line of text · a big number/title (`font:'serif'` = Didot family, `fill: paint(skin,'acc')` = gradient) · a floating name tag |
| `Ring` · `RingNote` | a ring (filled share, faint band, ticks, a hand that turns once a day) · a small note on the ring |
| `Flow` · `Spark` · `Dots` | capsule bars (light flowing up the current one) · a sparkline · a 7-row dot grid (today breathing, a marked dot with a tag) |
| `Sky` · `Lamps` | the sky for a time of day (the sun where it really is; at night the moon's phase, twinkling stars; drifting clouds, hills, a road) · lanterns on the road |
| `InkCircle` · `Rule` | a hand-drawn circle that draws itself once · a horizontal rule |
| `sunTimes` · `moonAge` · `moonName` · `hm` · `textW` | Seoul sunrise/sunset (minutes) · moon age · moon name · 9:05 format · text width estimate |
| `SKINS` · `skinOf` · `skinSwap` | the three skins · stored value → skin (default if unknown) · cross-fade on switch |
| `SkinBar(ui, SKINS, current, onPick)` (kit.tsx) | the skin button row (key `skin-<id>`, current one primary) |

The code is the same as the Korean example above.

- **Motion contract** — root `class="mode-anim"`, motion only in the @keyframes of the one `<style>` block, and the picture must be complete with all motion removed
  (a hand's angle sits on the outer g, draw-ons use `both`, the leaving layer is transparent by default). The app swaps in a still copy when nobody is looking or the Mac is busy
- **Spend motion sparingly** — motion inside an `<img>` redraws the whole picture every frame even for one dot (measured on one 1064px picture: renderer 10%, GPU 12%; still copy 3%, 2%). One or two breathing things per scene
- **Time** — `setTimeout` runs inside a mode. The examples redraw every 10 minutes and let CSS carry seconds and minutes in between (a hand turning once per 86400 s)
- **Terminal** — when `e.surface !== 'desktop'`, draw with the kit (text) instead; terminals can't draw Svg
- **Names** — gradients via `paint(skin, 'acc'|'v'|'shine'|'glow')` (skin-prefixed, so two layers never clash), colors via the skin's CSS variables (`var(--ink)`, `--dim`, `--line`, `--a1`, `--warm`, `--red`) in a class or `style="fill:var(…)"` (the examples never put variables in paint attributes like `fill="var(…)"`)
- **Many in one picture** — when there are several characters or scene pieces (like the team mode), keep one Svg, not many (each moving picture redraws on its own). Scope each piece's CSS under its own prefix (`.k-ch`, …) and pass it as the layer's `css` — it lands once in the one `<style>` block
- **Built-in modes only read** — the app's try-out modes run on every public user's Mac: no `$.process.run`, no transcripts (`~/.claude/projects`) — an app test blocks it. Session state comes from the `state` (work, wait, ask, idle, unknown) the app writes per session into `<data>/live.json`
- **Gotchas** — a mode module won't load if it reuses the names `$` or `on` as locals (`const on = …`) or passes `$` as a value (`Object.keys($)`). Module state (a picked day, …) carries over between tests in one test file — reset it at the end. One `mock.store` per test. The Svg text always contains the `.k-leave` CSS — check layers with `class="k-<skin> k-leave"`

## Web way (Client) — when

When you need full design freedom (layouts these props can't do, fast-changing state). `<Client module="./board.tsx" key="b1" props={{…}} />` —
the module runs in an **invisible room (sandboxed iframe)** inside the app and the app's renderer draws the tree it sends (the table and kit looks above apply inside Client too, except Svg).
- Pass data **only via props**. The room has no network (fetch and external loads are blocked) — the mode's hooks read data and pass it as props
- Presses go back to the mode (`ui_client_press`); the room talks to the mode with `surface.post`
- Try Box/Text and the kit first; use Client only when that can't do it
