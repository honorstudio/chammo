import type { EngineInterface, Register } from 'claude-code'
import { Card, Chip, Divider, SkinBar } from './kit'
import { SKINS, skinOf, skinSwap, svgDoc, type Skin } from './kit-svg'
import { cover, gauge, langOf, pick, sky, type Lang } from './scenes'

// Chammo 홈 맛보기 — 할 일. 넣기(Enter)·끝내기·끝난 것 치우기. 앱을 껐다 켜도 남게 $.store 에 둔다
// 데스크톱(Chammo)은 목록 위에 스킨 머리 그림 — 계기판(끝낸 몫 고리·남은 수) · 하늘(끝낸 몫만큼 해가 기울고 다 하면 별) · 표지(세리프 머리).
//   위 오른쪽 단추로 바꾸고 $.store 'skin' 에 기억(kit-svg skinSwap 으로 겹쳐 사라짐). 누르는 목록은 키트 그대로
const PANE = 'todo'
type Item = { text: string; done: boolean }
const SKIN_EN: Record<string, string> = { gauge: 'Gauge', sky: 'Sky', cover: 'Cover' }

async function items($: EngineInterface): Promise<Item[]> {
  const v = await $.store.get('items')
  return Array.isArray(v) ? (v as Item[]).filter((x) => x && typeof x.text === 'string') : []
}

async function save($: EngineInterface, next: Item[], lang: Lang) {
  await $.store.set('items', next)
  const left = next.filter((x) => !x.done).length
  $.ui.status(left ? pick(lang, `할 일 ${left}`, `To-do ${left}`) : undefined)
  await $.ui.invalidate('ui.render')
}

const swap = skinSwap()
async function pickSkin($: EngineInterface, id: string) {
  swap.pick()
  await $.store.set('skin', id)
  setTimeout(() => { if (swap.done()) void $.ui.invalidate('ui.render') }, 650)
  await $.ui.invalidate('ui.render')
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    void $.ui.open({ id: PANE, title: pick(await langOf($), '할 일', 'To-do') })
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const ui = $.ui.resolve(e)
    const { Box, Text, Button, Input, Svg } = ui
    const lang = await langOf($)
    const list = await items($)
    // 참모 모드 디자인 키트(./kit — Chammo hq-mode-kit): 카드 머리에 남은 수 칩, 끝난 것 위에 구분선
    const left = list.filter((x) => !x.done).length
    let head = null
    if (e.surface === 'desktop') {
      const skin: Skin = skinOf(await $.store.get('skin'))
      const props = e.props as { bodyColumns?: number }
      const W = ((typeof props.bodyColumns === 'number' && props.bodyColumns) || e.viewport?.columns || 40) * 8
      const t = await $.clock.now(), d = new Date(t + 9 * 3600000)
      const clock = { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate(), weekday: d.getUTCDay(), utc: t }
      const count = { done: list.length - left, total: list.length }
      const layer = skin === 'sky' ? sky(count, clock, W, lang) : skin === 'cover' ? cover(count, clock, W, lang) : gauge(count, W, lang)
      head = [
        <Box key="top" flexDirection="row" justifyContent="flex-end">{SkinBar(ui, lang === 'en' ? SKINS.map((k) => ({ ...k, name: SKIN_EN[k.id] ?? k.name })) : SKINS, skin, (id) => void pickSkin($, id))}</Box>,
        <Svg key="scene" source={svgDoc({ layers: swap.layers(layer) }).svg} alt={list.length ? pick(lang, `남은 일 ${left} · 전체 ${list.length}`, `${left} left of ${list.length}`) : pick(lang, '할 일 없음', 'No to-dos')} />,
      ]
    }
    const rows = (xs: (readonly [Item, number])[]) => xs.map(([x, i]) => (
      <Box key={`row-${i}`} flexDirection="row" gap={1} alignItems="center">
        <Button key={`done-${i}`} label={x.done ? pick(lang, '되살리기', 'Reopen') : pick(lang, '끝내기', 'Done')} onPress={async () => { const all = await items($); all[i] = { ...all[i]!, done: !all[i]!.done }; await save($, all, lang) }}>{x.done ? '■' : '□'}</Button>
        <Text strikethrough={x.done || undefined} dimColor={x.done || undefined}>{x.text}</Text>
      </Box>
    ))
    return (
      <Box flexDirection="column" gap={1}>
        {head}
        <Input key="add" placeholder={pick(lang, '할 일 넣기', 'Add a to-do')} submitLabel={pick(lang, '넣기', 'Add')}
          onSubmit={async (value) => { const t = value.trim(); if (t) await save($, [...(await items($)), { text: t, done: false }], lang) }} />
        {list.length > 0 && Card(ui, null, [
          <Box key="head" flexDirection="row" gap={1}><Text bold>{pick(lang, '오늘', 'Today')}</Text>{Chip(ui, left ? pick(lang, `남은 ${left}`, `${left} left`) : pick(lang, '다 했어', 'All done'), left ? 'suggestion' : 'success')}</Box>,
          ...rows(list.map((x, i) => [x, i] as const).filter(([x]) => !x.done)),
          ...(list.some((x) => x.done) && left ? [Divider(ui, 30, 'line')] : []),
          ...rows(list.map((x, i) => [x, i] as const).filter(([x]) => x.done)),
        ], 'list')}
        {list.some((x) => x.done) && <Button key="clear" label={pick(lang, '끝난 것 치우기', 'Clear finished')} onPress={async () => save($, (await items($)).filter((x) => !x.done), lang)} />}
      </Box>
    )
  })
}
