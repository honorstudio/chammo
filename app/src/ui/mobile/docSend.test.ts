// 폰 문서 보기 → 참모에게 보내기(11-06 사용자 '보고 있는 파일을 해당 참모 세션에게 보내는 기능 없음') — 데스크톱 SendToOrch 와 같은 일:
// 누르면 그 참모 입력칸에 #file 칩으로 붙고(보내기는 사람이) 채팅으로 돌아간다. 표 넷째 칸이 글자 하나씩 꺾이던 것도 같이
import { describe, expect, it } from 'vitest';
import view from './FileView.tsx?raw';
import composer from './Composer.tsx?raw';
import bus from '../refBus.ts?raw';
import text from './FileText.tsx?raw';
import css from './mobile.css?raw';

describe('폰 문서 보기 — 참모에게 보내기', () => {
  it('머리에 보내기 아이콘(참모가 있을 때) → 그 참모 입력칸에 파일 참조, 닫고 채팅으로', () => {
    expect(view).toMatch(/askRef\(orch, \{ kind: 'chat', who: '', text: '', file: \{ path, name: title \} \}\)/);
    expect(view).toContain('<IconChatSend />');
    expect(view).toMatch(/<TextView [^>]*orch=\{orch\}/);
  });
  it('입력칸은 파일 참조를 #file 칩으로(이미 붙은 경로면 또 안 붙인다)', () => {
    expect(bus).toContain('file?: { path: string; name: string }');
    expect(composer).toMatch(/if \(r\.file\) \{/);
    expect(composer).toContain('`#file${++count.current.file}`');
  });
});

describe('폰 md 표 — 긴 글 칸이 글자 하나씩 꺾이지 않게', () => {
  it('표 칸은 낱말을 안 쪼갠다(문서의 overflow-wrap:anywhere 를 끈다)', () => {
    expect(css).toMatch(/\.m-page\.m-md th, \.m-page\.m-md td \{[^}]*overflow-wrap: normal;[^}]*word-break: keep-all;/);
  });
  it('긴 글 칸엔 읽을 폭을 준다 — 표는 가로로 민다', () => {
    expect(css).toMatch(/\.m-page\.m-md td\.m-td-long \{[^}]*min-width: 14em/);
    expect(text).toContain("classList.toggle('m-td-long'");
  });
});
