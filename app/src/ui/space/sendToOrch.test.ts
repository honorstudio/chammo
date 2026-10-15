import { describe, expect, it } from 'vitest';

// 2026-10-11 사용자(176.png): 카드·탭의 '참모에게 보내기'가 클립·종이비행기라 참모에게 보내는 건지 헷갈렸다 —
// 그 참모 색으로 채운 말풍선 단추(SendToOrch) 하나로. 보관함 카드·탭 문서 머리·탭 미리보기·크게 보기 창이 같은 단추를 쓴다
const files = import.meta.glob(['/src/ui/space/{LockerPage,DocPage,SheetPage,FileTab,Preview}.tsx'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

describe('참모에게 보내기 = 참모 색 말풍선 단추', () => {
  it('다섯 화면을 읽었다', () => expect(Object.keys(files)).toHaveLength(5));
  it.each(['LockerPage', 'DocPage', 'SheetPage', 'FileTab', 'Preview'])('%s 는 클립·종이비행기 대신 SendToOrch', (name) => {
    const src = Object.entries(files).find(([f]) => f.endsWith(`/${name}.tsx`))![1];
    expect(src).not.toMatch(/<IconClip \/>/);
    expect(src).toMatch(/<SendToOrch\b/);
    if (name === 'LockerPage') expect(src).not.toMatch(/참모에게 보내기'[^\n]*<IconSend \/>/);
  });
});

// 2026-10-12 사용자(208.png): 말풍선 위 '참조' 단추가 아직 클립 — '참모 입력칸에 넣는다'는 같은 뜻이라 같은 참모 색 말풍선 모양으로
import chatView from '../chat/ChatView.tsx?raw';
const all = import.meta.glob(['/src/**/*.tsx', '!/src/**/*.test.tsx'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
describe('말풍선 참조 단추 = 같은 말풍선 모양', () => {
  it('참조 단추는 IconChatSend + 참모 색(send-orch), 이름은 #참조로 넣기', () => {
    const btn = chatView.slice(chatView.indexOf('const RefBtn'), chatView.indexOf('const RefBtn') + 500);
    expect(btn).toMatch(/className="chat-refbtn send-orch"/);
    expect(btn).toMatch(/<IconChatSend \/>/);
    expect(btn).toMatch(/label=\{tr\('이 말풍선을 입력칸에 #참조로 넣기'/);
    expect(btn).toMatch(/title=\{tr\('이 말풍선을 입력칸에 #참조로 넣기'/);
  });
  it('앱 어디에도 클립 아이콘이 다시 들어오지 않는다', () => {
    expect(Object.keys(all).length).toBeGreaterThan(50);
    for (const [f, src] of Object.entries(all)) expect([f, /<IconClip\b|IconClip[,\s}]/.test(src)]).toEqual([f, false]);
  });
});
