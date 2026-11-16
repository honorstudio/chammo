// ?guard=0 = 고치기 전(막이 없음), 그 밖 = 앱과 같은 막이(ui/TerminalPane attachCustomKeyEventHandler 첫 줄)
import '@xterm/xterm/css/xterm.css';
import { Terminal } from '@xterm/xterm';
import { imeKeypressGuard } from '../../src/domain/imeKeypress';

const on = new URLSearchParams(location.search).get('guard') !== '0';
const term = new Terminal();
term.open(document.getElementById('t')!);
const kp = imeKeypressGuard();
term.attachCustomKeyEventHandler((e) => {
  if (on && kp(e)) e.preventDefault();
  return true;
});
const w = window as unknown as { __sent: string[]; __ready: boolean; __ta: () => string };
w.__sent = [];
term.onData((d) => w.__sent.push(d));
w.__ta = () => term.textarea?.value ?? '';
term.focus();
w.__ready = true;
