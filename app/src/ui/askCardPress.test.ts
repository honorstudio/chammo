import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const src = readFileSync(new URL('./AgentBrowserModal.tsx', import.meta.url), 'utf8');
const body = (name: string) => { const i = src.indexOf(`export function ${name}`); return src.slice(i, src.indexOf('\n}\n', i)); };

// 10-28 사용자 "카드를 눌렀을 때 스페이스가 안 바뀜" — 카드 본문엔 누름 처리가 없고 오른쪽 위 단추만 열렸다
describe('사람 부르기 카드(AskCards) — 본문을 누르면 그 세션 브라우저 칸으로', () => {
  const card = body('AskCards');
  it('카드 본문이 눌린다 — 키보드로도(Enter·Space)', () => {
    expect(card).toMatch(/className="login-card browser-card[^"]*"[^>]*onClick=/s);
    expect(card).toMatch(/role="alert"[^>]*tabIndex=\{0\}|tabIndex=\{0\}[^>]*role="alert"/s);
    expect(card).toMatch(/onKeyDown/);
  });
  it('카드가 놓인 참모(owner)를 같이 넘긴다 — 독 규칙과 갈려도 누른 채팅 참모 칸으로', () => {
    expect(card).toMatch(/owner/);
    expect(card).toMatch(/openAgentModal\(l\.profile, l\.pid, owner\?\.id\)/);
  });
  it('안쪽 단추는 본문 누름과 겹쳐 두 번 열리지 않게 stopPropagation', () => {
    expect(card).toMatch(/stopPropagation/);
  });
});

describe('AgentAskHost — 눌림마다 스페이스 이동을 다시 시도', () => {
  const host = body('AgentAskHost');
  it('이미 열려 있어도(모달로 물러난 채) 다시 누르면 스페이스로 — 눌림 번호가 효과 의존에 든다', () => {
    expect(host).toMatch(/pressN/);
    expect(host).toMatch(/paneFn\(\)\?\.\(l\.profile, false, st\.open\?\.orch\)|paneFn\(\)\?\.\(l\.profile, false, orch\)/);
  });
});
