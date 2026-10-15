// 참모 모드 폰 칸 점검 — 모드 시험(claude plugin test)에서 그려진 트리(ui.drawn())를 폰 칸 크기에 대 본다(Chammo hq-mode-kit 스킬).
// 모드를 만들 때 늘 같이 돌린다: 폰 홈 카드·꽉 채워 보기 두 크기에서 문제 목록이 [] 여야 한다.
//   import { PHONE, phoneCheck } from './kit-phone'
//   for (const [name, size] of Object.entries(PHONE)) test(`폰 ${name}`, async ($, on) => {
//     const ui = await $.ui.mount({ plugin: '<이름>', surface: 'desktop', component: 'Pane', requestId: 'x', props: {} as never, viewport: { ...size, isFullscreen: true } })
//     expect(phoneCheck(await ui.drawn(), size)).toEqual([])
//   })
// 안쪽 화면(날짜 보기처럼 눌러 들어간 화면)을 시험할 땐 phoneCheck(tree, size, { inner: true }) — 키트 BackBar(‹)가 맨 앞에 있어야 한다.
/* eslint-disable @typescript-eslint/no-explicit-any */

/** 폰 칸 실제 크기(글자 칸 1 = 8px, 줄 1 = 18px) — 홈 카드 / 꽉 채워 보기. 앱이 모드에 주는 값 그대로(2026-10-12 실측) */
export const PHONE = { home: { columns: 41, rows: 28 }, full: { columns: 46, rows: 40 } } as const
/** 손가락 44px = 글자 칸 6개 — 폰 앱은 모드 단추를 44px 로 키운다 */
export const FINGER = 6
/** 폰에서 읽히는 가장 작은 글(px) — 그림(Svg) 속 글이 칸 폭에 맞춰 줄어든 뒤 */
export const MIN_TEXT_PX = 11

type Size = { columns: number; rows: number }
type Node = { type?: string; props?: Record<string, any>; children?: (Node | string)[] }

const kids = (n: Node) => (n.children ?? []).filter((c): c is Node => typeof c === 'object' && c !== null)
const name = (n: Node) => (n.props?.key ? `${n.type} ${n.props.key}` : String(n.type))
/** 글 폭(글자 칸) — 한글·한자 같은 넓은 글자는 2칸 */
export const textCols = (s: string) => [...s].reduce((w, ch) => w + (/[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/.test(ch) ? 2 : 1), 0)
const textOf = (n: Node): string => (n.children ?? []).map((c) => (typeof c === 'string' ? c : textOf(c))).join('')
/** 단추 하나가 차지하는 칸 — 글 + 앞뒤 여백, 적어도 손가락 하나 */
const buttonCols = (n: Node) => Math.max(FINGER, textCols(textOf(n) || String(n.props?.label ?? '')) + 2)
const fixedCols = (n: Node) => (n.type === 'Button' ? buttonCols(n) : typeof n.props?.width === 'number' ? n.props.width : typeof n.props?.minWidth === 'number' ? n.props.minWidth : 0)

function svgProblems(n: Node, size: Size): string[] {
  const src = String(n.props?.source ?? '')
  const tag = src.match(/<svg\b[^>]*>/)?.[0] ?? ''
  const vb = tag.match(/viewBox="\s*[-\d.]+\s+[-\d.]+\s+([\d.]+)/)?.[1]
  const w = Number(tag.match(/\swidth="([\d.]+)/)?.[1] ?? vb ?? 0)
  if (!w) return []
  const scale = Math.min(1, (size.columns * 8) / w)
  const sizes = [...src.matchAll(/font-size(?:="|:\s*)([\d.]+)/g)].map((m) => Number(m[1])).filter((x) => x > 0)
  if (!sizes.length) return []
  const px = Math.min(...sizes) * scale
  return px < MIN_TEXT_PX ? [`${name(n)}: 그림 속 가장 작은 글 ${px.toFixed(1)}px — 폰 칸(${size.columns * 8}px)에 맞춰 줄면 ${MIN_TEXT_PX}px 아래`] : []
}

/** 폰 칸에서 문제가 될 것 목록 — 빈 배열이면 통과 */
export function phoneCheck(tree: unknown, size: Size, opts: { inner?: boolean } = {}): string[] {
  const out: string[] = []
  const buttons: Node[] = []
  const walk = (n: Node) => {
    const p = n.props ?? {}
    if (n.type === 'Button') {
      buttons.push(n)
      if (!String(p.label ?? '').trim()) out.push(`${name(n)}: 단추에 label 이 없다 — 아이콘·기호만 든 단추도 읽을 이름이 있어야 한다`)
    }
    if (typeof p.width === 'number' && p.width > size.columns) out.push(`${name(n)}: 폭 ${p.width}칸 > 폰 칸 ${size.columns}칸 — 가로로 넘친다`)
    if (n.type === 'Box' && (p.flexDirection ?? 'row') === 'row' && p.flexWrap !== 'wrap') {
      const row = kids(n)
      const gap = typeof (p.columnGap ?? p.gap) === 'number' ? (p.columnGap ?? p.gap) : 0
      const need = row.reduce((s, c) => s + fixedCols(c), 0) + gap * Math.max(0, row.length - 1)
      if (row.filter((c) => c.type === 'Button').length > 1 && need > size.columns) {
        out.push(`${name(n)}: 단추 줄이 ${need}칸 > 폰 칸 ${size.columns}칸 — 손가락 44px(${FINGER}칸)로 한 줄에 안 들어간다(flexWrap="wrap" 이나 줄 나누기)`)
      }
    }
    if (n.type === 'Svg') out.push(...svgProblems(n, size))
    kids(n).forEach(walk)
  }
  walk((tree ?? {}) as Node)
  if (opts.inner) {
    const back = buttons.findIndex((b) => b.props?.key === 'mode-back')
    if (back < 0) out.push('안쪽 화면인데 뒤로 단추(kit BackBar, key mode-back)가 없다 — 칸 X 는 칸을 끈다')
    else if (back > 0) out.push(`뒤로 단추가 맨 앞이 아니다(단추 ${back + 1}번째) — 늘 같은 자리(왼쪽 위)에`)
  }
  return out
}
