import type { EngineInterface, Register, RenderChildren } from 'claude-code'

import { FACE_TEXT, STATUS_WORD } from './avatar'
import { SkinBar } from './kit'
import { SKINS, skinOf, skinSwap, svgDoc, type Skin } from './kit-svg'
import { cover, gauge, sky } from './scenes'
import { assistantBases, avatarOf, fit, openAsks, parseLive, parseOrder, parseRoles, pickChammos, statusOf } from './model'
import type { Look, Status } from './model'

// 참모 상태 — 참모(참모-N 세션)마다 귀여운 캐릭터 하나가 일함·기다림·손바닥(사용자 답 기다림)·쉼(졸기)을 움직임으로 보여 준다.
// 읽기만 한다: 앱이 쓴 live.json(세션마다 사이드바와 같은 state)·direct.jsonl·avatars/·config.json. 대화 기록·프로세스는 안 쓴다(공개판 기본 모드). 세션에 말 걸기·끄기는 없다.
// 폴링은 아낀다 — 칸이 안 그려지면(가려짐) 다음 주기를 건너뛰고, 파일이 안 바뀌면 다시 안 읽고, 결과가 같으면 다시 안 그린다
const PANE = 'team-status'
const TITLE = '참모 상태'
const POLL_MS = 5_000

type Tile = { id: string; key: string; role: string; status: Status; look: Look }
type Cached = { mtime: number; size: number; text: string }

let home = ''
let dataDir = ''
let hqDir = ''
let assistant = '' // 설정 이름(config assistantName) — 비서 이름은 이것 + 참모·참모·Chammo
let ready: Promise<void> | null = null
let tiles: Tile[] | null = null // null = 아직 한 번도 못 읽음
let problem = false // live.json 을 못 읽음(앱이 꺼졌거나 데이터 폴더가 다름)
let sig = ''
let polling = false
let ticking = false
let lastPoll = 0
// 다시 그려 달라고 했는데 아직 안 그려짐 = 아무도 안 본다(칸이 가려짐) — 그동안은 주기를 건너뛴다
let undrawn = false
let seen = { columns: 0, rows: 0 }
const files = new Map<string, Cached>()

const expand = (p: string) => (p.startsWith('~/') ? `${home}${p.slice(1)}` : p)

/** 바뀐 파일만 다시 읽는다(stat 의 mtime·크기로). 없거나 못 읽으면 undefined */
async function readIfChanged($: EngineInterface, path: string): Promise<string | undefined> {
  try {
    const st = await $.fs.stat(path)
    const old = files.get(path)
    if (old && old.mtime === st.mtimeMs && old.size === st.size) return old.text
    const text = await $.fs.read(path)
    files.set(path, { mtime: st.mtimeMs, size: st.size, text })
    return text
  } catch {
    files.delete(path)
    return undefined
  }
}

/** 데이터 폴더·HQ 폴더·이름 — 앱과 같은 규칙($CHAMMO_HOME → ~/.chammo → 옛 설치 ~/.honor-orchestrator).
 *  앱은 모드 호스트에 CHAMMO_HOME 을 넘긴다. 윈도우엔 HOME 이 없을 수 있어 USERPROFILE 도 본다 */
async function setup($: EngineInterface) {
  home = ((await $.env.get('HOME')) || (await $.env.get('USERPROFILE')) || '').replace(/[\\/]+$/, '')
  const env = ((await $.env.get('CHAMMO_HOME')) ?? '').trim()
  if (env) dataDir = expand(env)
  else dataDir = (await $.fs.exists(`${home}/.chammo`).catch(() => false)) ? `${home}/.chammo` : `${home}/.honor-orchestrator`
  let config: { hqDir?: unknown; assistantName?: unknown } = {}
  try {
    config = JSON.parse(await $.fs.read(`${dataDir}/config.json`)) as typeof config
  } catch {
    // 설정이 없으면 기본값
  }
  // 설정에 없을 때 기본값도 앱과 같게 — 새 설치 <데이터>/hq, 옛 설치(설정 없이 ~/.honor-orchestrator 만)는 주인 HQ
  const legacy = dataDir === `${home}/.honor-orchestrator`
  const hqDefault = legacy ? '~/Desktop/dev/honor-orchestrator' : `${dataDir}/hq`
  hqDir = expand(typeof config.hqDir === 'string' && config.hqDir.trim() ? config.hqDir.trim() : hqDefault)
  if (typeof config.assistantName === 'string' && config.assistantName.trim()) assistant = config.assistantName.trim()
}

async function poll($: EngineInterface) {
  if (polling) return
  polling = true
  try {
    ready ??= setup($)
    await ready
    lastPoll = await $.clock.now()
    const liveText = await readIfChanged($, `${dataDir}/live.json`)
    const next = liveText === undefined ? null : await read($, liveText)
    const nextProblem = liveText === undefined
    const nextSig = JSON.stringify([nextProblem, next])
    if (nextSig === sig) return // 바뀐 게 없으면 다시 안 그린다
    sig = nextSig
    problem = nextProblem
    tiles = next ?? []
    undrawn = true
    await $.ui.invalidate('ui.render')
  } finally {
    polling = false
  }
}

async function read($: EngineInterface, liveText: string): Promise<Tile[]> {
  const [roles, order, direct] = await Promise.all([
    readIfChanged($, `${dataDir}/orch-roles.json`),
    readIfChanged($, `${dataDir}/orch-order.json`),
    readIfChanged($, `${dataDir}/direct.jsonl`),
  ])
  const chammos = pickChammos(parseLive(liveText), { hqDir, assistants: assistantBases(assistant), order: parseOrder(order), roles: parseRoles(roles) })
  const asking = openAsks(direct)
  return Promise.all(chammos.map(async (c) => {
    const avatar = await readIfChanged($, `${dataDir}/avatars/${c.key}.json`)
    return { id: c.sessionId, key: c.key, role: c.role, status: statusOf(c.state, c.busy, asking.has(c.sessionId.slice(0, 8))), look: avatarOf(avatar, c.num) }
  }))
}

// 스킨 — 계기판(상태 고리 격자) · 하늘(이 시각 하늘 아래 길 위) · 표지(큰 세리프 + 명단). 고른 것은 $.store 'skin', 바꿀 때 겹쳐 사라짐
const swap = skinSwap()
async function pickSkin($: EngineInterface, id: string) {
  swap.pick()
  await $.store.set('skin', id)
  setTimeout(() => { if (swap.done()) void $.ui.invalidate('ui.render') }, 650)
  await $.ui.invalidate('ui.render')
}

/** 주기마다 — 지난번에 다시 그려 달라고 한 게 그려졌을 때만(안 보면 안 부른다) */
async function tick($: EngineInterface) {
  if (!undrawn) await poll($)
}

export const register: Register = (on) => {
  on('session.start', async ($, e, next) => {
    void $.ui.open({ id: PANE, title: TITLE })
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const ui = $.ui.resolve(e)
    const { Box, Text } = ui
    // 앱은 칸 크기를 props(bodyColumns·bodyRows)와 viewport 둘 다에 보낸다(modes.rs render_req)
    const props = e.props as { bodyColumns?: number; bodyRows?: number; scroll?: { bodyRows?: number } }
    const num = (n: unknown) => (typeof n === 'number' && n > 0 ? n : 0)
    const columns = num(props.bodyColumns) || e.viewport?.columns || 40
    const rows = num(props.bodyRows) || num(props.scroll?.bodyRows) || e.viewport?.rows || 12
    if (columns !== seen.columns || rows !== seen.rows) {
      // 앱이 실제로 보내는 칸 크기 — 크기별 시험값을 실측으로 굳히려고 남긴다(비밀 없음)
      seen = { columns, rows }
      void $.store.set('viewport', seen)
    }
    undrawn = false
    if (!ticking) {
      ticking = true
      $.clock.every(POLL_MS, () => void tick($))
    }
    // 처음이거나, 가려졌다가 다시 보일 때 — 바로 부른다
    if (tiles === null || (await $.clock.now()) - lastPoll >= POLL_MS) void poll($)

    if (tiles === null) return <Box key="loading" />
    if (problem || tiles.length === 0) {
      return (
        <Box key="empty" height={rows} justifyContent="center" alignItems="center">
          <Text dimColor wrap="truncate-end">{problem ? '앱 데이터를 못 읽었어요' : '켜진 참모가 없어요'}</Text>
        </Box>
      )
    }

    const terminal = e.surface === 'terminal'
    const laid = fit(terminal ? 'terminal' : 'desktop', columns, rows, tiles.length)
    const center = (key: string, child: RenderChildren) => <Box key={key} flexDirection="row" justifyContent="center">{child}</Box>
    // 같은 폭 N열 — 키트 Grid 와 같은 조합(칸마다 정수 %)에 줄 사이 틈(rowGap 2 = 8px, model fit 과 같은 값)만 더했다
    const grid = (cells: RenderChildren[]) => {
      const w = `${Math.floor(100 / laid.perRow)}%`
      return (
        <Box key="grid" flexDirection="row" flexWrap="wrap" rowGap={terminal ? 0 : 2}>
          {cells.map((c, i) => <Box key={`g-${i}`} width={w} flexDirection="column">{c}</Box>)}
        </Box>
      )
    }

    if (terminal || !('Svg' in ui)) {
      // 터미널 — 그림 대신 얼굴 글(쉼·모름은 흐리게) + 이름 + 맡은 일
      const cells = tiles.map((t) => (
        <Box key={t.id} flexDirection="row" gap={1}>
          <Text color={t.status === 'ask' ? 'warning' : t.status === 'work' ? t.look.color : undefined} dimColor={t.status === 'rest' || t.status === 'unknown' || undefined}>{FACE_TEXT[t.status]}</Text>
          {laid.show !== 'face' && <Text bold wrap="truncate-end">{t.key}</Text>}
          {laid.show === 'full' && t.role && <Box flexShrink={1}><Text dimColor wrap="truncate-end">{t.role}</Text></Box>}
        </Box>
      ))
      return grid(cells)
    }

    // 데스크톱 — 참모 모두를 Svg 한 장에(그림이 여럿이면 움직일 때 그만큼 다시 그린다), 위 오른쪽 스킨 단추
    const { Svg } = ui as typeof ui & { Svg: (p: { source: string; alt: string }) => unknown }
    const skin: Skin = skinOf(await $.store.get('skin'))
    const t = new Date((await $.clock.now()) + 9 * 3600_000)
    const clock = { year: t.getUTCFullYear(), month: t.getUTCMonth() + 1, day: t.getUTCDate(), hour: t.getUTCHours(), minute: t.getUTCMinutes(), weekday: t.getUTCDay(), utc: await $.clock.now() }
    const bar = rows >= 8 && columns >= 30
    const W = columns * 8, maxH = Math.max(48, rows * 18 - (bar ? 52 : 4))
    const layer = skin === 'sky' ? sky(tiles, clock, W, maxH) : skin === 'cover' ? cover(tiles, clock, W) : gauge(tiles, W, maxH)
    const { svg } = svgDoc({ layers: swap.layers(layer), maxH })
    return (
      <Box key="team" flexDirection="column" gap={bar ? 2 : 0}>
        {bar && <Box key="top" flexDirection="row" justifyContent="flex-end">{SkinBar(ui, SKINS, skin, (id) => void pickSkin($, id))}</Box>}
        <Svg source={svg} alt={tiles.map((x) => `${x.key} ${STATUS_WORD[x.status]}`).join(' · ')} />
      </Box>
    )
  })
}
