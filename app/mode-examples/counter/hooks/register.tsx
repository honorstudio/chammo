import type { EngineInterface, Register } from 'claude-code'

// Chammo example mode: a number that goes up when pressed.
// Band above the prompt (AbovePrompt) + one pane (board), status line and toast.
const PANE = 'board'
let count = 0

async function bump($: EngineInterface, next: number) {
  count = next
  $.ui.status(`Counter ${count}`)
  $.ui.toast(`Pressed ${count}`)
  await $.ui.invalidate('ui.render')
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    void $.ui.open({ id: PANE, title: 'Counter' })

    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)

    return (
      <Box gap={1}>
        <Text color="cyan">Pressed {String(count)}</Text>
        <Button key="inc" label="Up" variant="primary" onPress={() => bump($, count + 1)} />
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button, Markdown } = $.ui.resolve(e)

    return (
      <Box flexDirection="column" gap={1}>
        <Text bold>Counter board</Text>
        <Markdown text={`- value: **${count}**\n- surface: ${e.surface}`} />
        <Box gap={1}>
          <Button key="inc" label="Up" variant="primary" onPress={() => bump($, count + 1)} />
          <Button key="reset" label="Reset" onPress={() => bump($, 0)} />
        </Box>
      </Box>
    )
  })
}
