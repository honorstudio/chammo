import { beforeEach, describe, expect, it, vi } from 'vitest';
import chat from './ChatView.tsx?raw';
import card from './ChatFileCard.tsx?raw';
import space from '../space/SpaceView.tsx?raw';
import css from './chat.css?raw';

const calls: { cmd: string; args: Record<string, unknown> }[] = [];
vi.mock('@tauri-apps/api/core', () => ({
  invoke: async (cmd: string, args: Record<string, unknown>) => { calls.push({ cmd, args }); return cmd === 'save_attach' ? `/h/data/attach/${calls.length}-${String(args.name)}` : undefined; },
}));
const { CHAT_FILE_OPEN, imageFile, openChatFile } = await import('./openChatFile');

// 채팅 말풍선에 붙은 그림(#img1)·파일(#file1)을 누르면 scripts/show 와 같은 길로 — 채팅 뷰는 스페이스 탭, 터미널 뷰는 리더(2026-10-19 사용자)
const sent: Event[] = [];
let spaceMode = true;
beforeEach(() => {
  calls.length = 0;
  sent.length = 0;
  spaceMode = true;
  vi.stubGlobal('window', { dispatchEvent: (e: Event) => { sent.push(e); return true; } });
  vi.stubGlobal('document', { querySelector: (q: string) => (q === '.space-mode' && spaceMode ? {} : null) });
});
const tick = () => new Promise((r) => setTimeout(r, 0));

describe('openChatFile — show 와 같은 자리에 연다', () => {
  it('채팅 뷰(스페이스)면 CHAT_FILE_OPEN — 참모가 띄운 파일 카드와 같은 신호', async () => {
    await openChatFile('/h/가.png', 'pane-a');
    expect(sent).toHaveLength(1);
    expect(sent[0]!.type).toBe(CHAT_FILE_OPEN);
    expect((sent[0] as CustomEvent).detail).toEqual({ path: '/h/가.png', by: 'pane-a' });
    expect(calls.filter((c) => c.cmd === 'reader_open')).toEqual([]);
  });

  it('터미널 뷰면 리더(reader_open) — scripts/show 가 터미널 뷰에서 여는 곳', async () => {
    spaceMode = false;
    await openChatFile('/h/나.pdf', 'pane-a');
    expect(sent).toEqual([]);
    expect(calls).toEqual([{ cmd: 'reader_open', args: { paths: ['/h/나.pdf'] } }]);
  });

  it('경로 없는 그림(data URL)은 파일로 한 번만 저장해 그 경로로 연다 — 다시 눌러도 새 파일을 안 만든다', async () => {
    const src = `data:image/png;base64,${btoa('png!')}`;
    await openChatFile(src, 'pane-a');
    await openChatFile(src, 'pane-a');
    await tick();
    const saves = calls.filter((c) => c.cmd === 'save_attach');
    expect(saves).toHaveLength(1);
    expect(saves[0]!.args).toEqual({ name: 'pasted.png', bytes: [...'png!'].map((c) => c.charCodeAt(0)) });
    expect(sent.map((e) => (e as CustomEvent).detail.path)).toEqual(['/h/data/attach/1-pasted.png', '/h/data/attach/1-pasted.png']);
  });

  it('jpeg 는 .jpg 로, 경로는 그대로, 모르는 data URL 은 열지 않는다', async () => {
    expect(await imageFile(`data:image/jpeg;base64,${btoa('j')}`)).toMatch(/pasted\.jpg$/);
    expect(await imageFile('/h/다.txt')).toBe('/h/다.txt');
    await openChatFile('data:image/svg+xml;utf8,<svg/>', 'pane-a');
    expect(sent).toEqual([]);
    expect(calls).toEqual([{ cmd: 'save_attach', args: expect.anything() }]);
  });
});

describe('누르는 곳 — 말풍선 그림·파일, 파일 카드가 같은 함수', () => {
  it('말풍선 그림(Thumb)을 누르면 openChatFile — 제자리 크게 보기가 아니다', () => {
    expect(chat).toMatch(/className="chat-thumb"[^>]*onClick=\{\(\) => void openChatFile\(src, by\)\}/);
    expect(chat).not.toMatch(/setBig/);
  });
  it('말풍선 파일(#file 경로)도 누르는 단추 — openChatFile(x.path, by)', () => {
    expect(chat).toMatch(/<button[^>]*className="chat-file"[^>]*onClick=\{\(\) => void openChatFile\(x\.path, by\)\}/);
  });
  it('파일 단추 글자는 11px 그대로 — .cv button { font: inherit } 보다 무겁게(하네스에서 13.5px 로 덮인 것)', () => {
    expect(css.length).toBeGreaterThan(0);
    expect(css).toMatch(/\.bubble button\.chat-file \{ font: inherit; font-size: 11px;/);
  });
  it('말풍선에 by(이 채팅 참모 칸 id)를 넘긴다', () => {
    expect(chat).toMatch(/<Bubble [^>]*by=\{paneId \?\? ''\}/);
  });
  it('참모가 띄운 파일 카드도 같은 함수를 쓴다(새로 안 만든다)', () => {
    expect(card).toMatch(/openChatFile\(f\.path, by, f\.at, !!f\.at\)/); // 짚은 곳이 있으면 미리보기(참모 앱은 자리를 모른다)
    expect(card).not.toMatch(/new CustomEvent/);
  });
  it('스페이스는 같은 신호를 받고, 붙이기(attach)도 같은 저장 함수를 쓴다', () => {
    expect(space).toMatch(/import \{ CHAT_FILE_OPEN, imageFile \} from '\.\.\/chat\/openChatFile'/);
    expect(space).toMatch(/imageFile\(path\)/);
    expect(space).not.toMatch(/save_attach/);
  });
});
