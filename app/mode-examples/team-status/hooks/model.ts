// 참모 상태 — 순수 함수(파일 글 → 참모 목록·상태·칸 배치). 읽기·그리기는 register.tsx
// 상태는 앱이 live.json 에 쓴 판정을 그대로 — 사이드바·사무실과 홈 칸이 같은 말을 한다(원본 status-mode-src ADR 0001 후속)

/** 일함 · 기다림(띄운 일) · 물음(사람 답 기다림 — 말풍선) · 쉼 · 모름 */
export type Status = 'work' | 'wait' | 'ask' | 'rest' | 'unknown'

/** label = 앱 별명(아직 진짜 이름에 안 실린 것 — 앱이 같이 쓴다) */
export type LiveSession = { sessionId: string; name: string; cwd: string; busy: boolean; startedAt: number; state?: LiveState; label?: string }
/** key = 기본 이름(참모-2 — 프사·맡은 일 열쇠), name = 이름표(앱 displayName 과 같은 규칙) */
export type Chammo = { sessionId: string; key: string; num: number; name: string; role: string; cwd: string; busy: boolean; state?: LiveState }

/** live.json(앱이 쓰는 세션 목록) → 세션들. 모양이 다른 줄은 버린다 */
export function parseLive(text: string): LiveSession[] {
  let d: unknown
  try {
    d = JSON.parse(text)
  } catch {
    return []
  }
  const list = (d as { sessions?: unknown } | null)?.sessions
  if (!Array.isArray(list)) return []
  const out: LiveSession[] = []
  for (const s of list) {
    if (!s || typeof s !== 'object') continue
    const o = s as Record<string, unknown>
    if (typeof o.sessionId !== 'string' || typeof o.name !== 'string' || typeof o.cwd !== 'string') continue
    out.push({ sessionId: o.sessionId, name: o.name, cwd: o.cwd, busy: o.busy === true, startedAt: typeof o.startedAt === 'number' ? o.startedAt : 0, ...(typeof o.state === 'string' && LIVE_STATES.includes(o.state) ? { state: o.state as LiveState } : {}), ...(typeof o.label === 'string' && o.label.trim() ? { label: o.label.trim() } : {}) })
  }
  return out
}

const NICK = ' · ' // 앱 orchLabel NICK_SEP — '참모-2 · 감독'(뒤는 별명, 2026-10-02 부터)
const trimSlash = (p: string) => p.replace(/\/+$/, '')
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** 비서로 치는 이름 — 설정 이름(config assistantName) + 옛 이름 + 두 언어 기본 이름(앱 session.ts assistantBases) */
export const assistantBases = (configured: string) => [...new Set([configured, '참모', '참모', 'Chammo'].filter(Boolean))]

/** 참모 = HQ 폴더(워크트리 아님)에서 도는 비서 이름 세션 — '<이름>' 이나 '<이름>-N', 뒤에 ' · 별명'(앱 orchestratorLike).
 *  그 밖 HQ 세션(예약·도우미)은 뺀다. 순서 = 앱 사이드바 순서(orch-order.json), 거기 없으면 번호순. 맡은 일 = orch-roles 의 첫 마디.
 *  ' · ' 뒤를 맡은 일로 읽어 이름표에 '참모-N' 만 남았다(공개 이슈 #3) — 이름표는 앱 displayName 규칙(shownNames) */
export function pickChammos(live: LiveSession[], o: { hqDir: string; assistants: string[]; order: string[]; roles?: Record<string, string> }): Chammo[] {
  const hq = trimSlash(o.hqDir)
  const re = new RegExp(`^((?:${o.assistants.map(escape).join('|')})(?:-(\\d+))?)(?:${escape(NICK)}(.*))?$`)
  const out: Chammo[] = []
  for (const s of live) {
    if (trimSlash(s.cwd) !== hq) continue
    const m = re.exec(s.name.normalize('NFC').trim())
    if (!m) continue
    const key = m[1]!
    const name = s.label ?? ((m[3] ?? '').trim() || stripNum(key))
    out.push({ sessionId: s.sessionId, key, num: m[2] ? Number(m[2]) : 1, name, role: firstPhrase(o.roles?.[key] ?? ''), cwd: s.cwd, busy: s.busy, ...(s.state ? { state: s.state } : {}) })
  }
  shownNames(out)
  const rank = (c: Chammo) => {
    const i = o.order.indexOf(c.sessionId)
    return i < 0 ? 1e6 + c.num : i
  }
  return out.sort((a, b) => rank(a) - rank(b))
}

// ── 이름표 — 앱 domain/orchLabel displayName 과 같은 규칙(모드는 앱 코드를 못 불러온다 — 앱 시험 orchLabelMode 가 둘을 견준다) ──

/** 기본 이름에서 끝 번호를 뺀 이름(참모-3 → 참모) */
const stripNum = (base: string) => base.replace(/[-\s]*\d+$/, '').trim() || base
/** 꼬리 — 번호 대신 글자(2 → B) */
const tail = (n: number) => String.fromCharCode(65 + ((n - 1) % 26))

/** 같은 이름표가 둘 이상이면(대소문자 무시) 번호 있는 쪽에 짧은 꼬리 — '조사 C' */
function shownNames(list: Chammo[]): void {
  const plain = list.map((c) => c.name)
  list.forEach((c, i) => {
    const me = plain[i]!.toLowerCase()
    if (!plain.some((p, j) => j !== i && p.toLowerCase() === me)) return
    const num = c.key.match(/(\d+)$/)?.[1]
    if (num) c.name = `${plain[i]} ${tail(Number(num))}`
  })
}

/** orch-roles 의 긴 설명 → 첫 마디('—'·'(' 앞, 쉼표·마침표 앞) */
function firstPhrase(s: string): string {
  return s.split(/\s+—\s+|\s+-\s+|[,.;]\s/)[0]!.trim()
}

/** orch-roles.json → 키별 맡은 일 */
export function parseRoles(text: string | undefined): Record<string, string> {
  try {
    const d = JSON.parse(text ?? '') as Record<string, { role?: unknown }>
    const out: Record<string, string> = {}
    for (const [k, v] of Object.entries(d ?? {})) if (typeof v?.role === 'string' && v.role) out[k.normalize('NFC')] = v.role
    return out
  } catch {
    return {}
  }
}

/** orch-order.json → 세션 id 순서 */
export function parseOrder(text: string | undefined): string[] {
  try {
    const d = JSON.parse(text ?? '') as unknown
    return Array.isArray(d) ? d.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

// ── 상태 — 앱이 live.json 세션마다 쓴 state(사이드바와 같은 판정, 앱 domain/revive liveState) ──
// 기본 모드는 대화 기록을 읽지 않는다(공개판 사용자 기록·프로세스 실행 금지, 2026-10-12 — ADR 0001 재검토 조건 ②)

export type LiveState = 'work' | 'wait' | 'ask' | 'idle' | 'unknown'
const LIVE_STATES: readonly string[] = ['work', 'wait', 'ask', 'idle', 'unknown']

/** 상태 — state = 앱 판정(없으면 옛 앱: busy 로만), card = 결정 대기함에 열린 카드(늘 물음) */
export function statusOf(state: LiveState | undefined, busy: boolean, card: boolean): Status {
  if (card) return 'ask'
  switch (state) {
    case 'work': return 'work'
    case 'wait': return 'wait'
    case 'ask': return 'ask'
    case 'idle': return 'rest'
    case 'unknown': return 'unknown'
    default: return busy ? 'work' : 'rest'
  }
}

/** direct.jsonl(결정 대기함) → 답을 기다리는 카드를 띄운 세션들(세션 id 앞 8자 — scripts/direct 의 from = 잡 폴더 이름).
 *  카드 상태 규칙은 scripts/direct card_view 와 같다: 답·처리·거둠이면 닫힘, 같은 세션이 새로 물으면 옛 것은 지난 질문 */
export function openAsks(text: string | undefined): Set<string> {
  const cards = new Map<string, { from: string; open: boolean }>()
  for (const raw of (text ?? '').split('\n')) {
    let r: { type?: unknown; id?: unknown; from?: unknown }
    try {
      r = JSON.parse(raw) as typeof r
    } catch {
      continue
    }
    if (!r || typeof r !== 'object' || typeof r.id !== 'string') continue
    if (r.type === 'ask' && typeof r.from === 'string') {
      for (const c of cards.values()) if (c.from === r.from) c.open = false
      cards.set(r.id, { from: r.from, open: true })
      continue
    }
    const c = cards.get(r.id)
    if (!c) continue
    if (r.type === 'answer' || r.type === 'done' || r.type === 'cancel') c.open = false
    else if (r.type === 'answer-failed') c.open = true
  }
  return new Set([...cards.values()].filter((c) => c.open).map((c) => c.from))
}

// ── 프사 (앱 domain/avatar.ts 의 저장 형식·기본형) ──

export const SHAPES = ['mochi', 'circle', 'star', 'cloud', 'capsule', 'sprout', 'tri', 'square', 'drop', 'bun', 'jelly', 'dome', 'hexa'] as const
export type Shape = (typeof SHAPES)[number]
export const EYES = ['pill', 'pupil', 'dark'] as const
export type Eyes = (typeof EYES)[number]
export const ORCH_COLORS = ['#2f74e0', '#d9622b', '#1f9a62', '#9b51e0', '#c98a00', '#d23f6b']
export type Look = { shape: Shape; eyes: Eyes; color: string }

const at = <T,>(list: readonly T[], num: number) => list[(((num - 1) % list.length) + list.length) % list.length]!

/** avatars/<키>.json 글 → 도형·눈·색. 없거나 이상하거나 올린 그림(아직 못 그림)이면 번호로 고른 기본형. 색이 없으면 번호 색 */
export function avatarOf(text: string | undefined, num: number): Look {
  const base: Look = { shape: at(SHAPES, num), eyes: 'pill', color: at(ORCH_COLORS, num) }
  let o: Record<string, unknown>
  try {
    o = JSON.parse(text ?? '') as Record<string, unknown>
  } catch {
    return base
  }
  if (!o || o.kind !== 'preset' || !SHAPES.includes(o.shape as Shape) || !EYES.includes(o.eyes as Eyes)) return base
  const color = typeof o.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(o.color) ? o.color : base.color
  return { shape: o.shape as Shape, eyes: o.eyes as Eyes, color }
}

// ── 칸 맞추기 ──

/** full = 얼굴 + 이름 + 맡은 일, name = 얼굴 + 이름, face = 얼굴만. face 크기(px)·한 줄 칸 수·칸 폭/높이(앱 px, 터미널 글자·줄) */
export type Fit = { show: 'full' | 'name' | 'face'; face: number; perRow: number; tileW: number; tileH: number; rowGap: number }

// 앱(desktop) 렌더러 단위 — 가로 1칸 = 8px, 세로 1줄 = 18px, 글 한 줄 = 18px, 칸 본문 여유 4px(schedule-mode 실측)
const PX = { col: 8, row: 18, text: 18, slack: 4, gap: 4, rowGap: 8 }
const VARIANTS = [
  { show: 'full' as const, max: 144, min: 44, lines: 2, minW: 12 * PX.col },
  { show: 'name' as const, max: 88, min: 32, lines: 1, minW: 8 * PX.col },
  { show: 'face' as const, max: 96, min: 16, lines: 0, minW: 0 },
]

/** 받은 칸(bodyColumns × bodyRows)에 참모 n 명이 스크롤 없이 들어가는 가장 큰 모양. 줄마다 고르게(4명이 3+1 이 아니라 2+2) */
export function fit(surface: 'desktop' | 'terminal', columns: number, rows: number, n: number): Fit {
  const count = Math.max(1, n)
  if (surface === 'terminal') {
    // 터미널 — 한 칸 = 한 줄(얼굴 글 + 이름 + 맡은 일). 줄이 모자라면 여러 열
    const perRow = Math.min(count, Math.max(1, Math.ceil(count / Math.max(1, rows))))
    const tileW = Math.max(1, Math.floor(columns / perRow))
    return { show: tileW >= 28 ? 'full' : tileW >= 14 ? 'name' : 'face', face: 1, perRow, tileW, tileH: 1, rowGap: 0 }
  }
  const W = columns * PX.col
  const H = rows * PX.row - PX.slack
  for (const v of VARIANTS) {
    for (let face = v.max; face >= v.min; face -= 4) {
      const tileW = Math.max(face + PX.col, v.minW)
      const most = Math.min(count, Math.floor(W / tileW))
      if (most < 1) continue
      const lines = Math.ceil(count / most)
      const perRow = Math.ceil(count / lines)
      const tileH = face + (v.lines ? PX.gap + v.lines * PX.text : 0)
      if (lines * tileH + (lines - 1) * PX.rowGap <= H) return { show: v.show, face, perRow, tileW, tileH, rowGap: PX.rowGap }
    }
  }
  // 아무것도 안 들어가면 가장 작은 얼굴로(칸이 정말 작다)
  const face = 16
  const perRow = Math.min(count, Math.max(1, Math.floor(W / (face + PX.col))))
  return { show: 'face', face, perRow, tileW: face + PX.col, tileH: face, rowGap: PX.rowGap }
}
