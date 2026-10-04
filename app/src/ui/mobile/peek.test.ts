import { describe, expect, it } from 'vitest';
import type { ChatItem } from '../../domain/chat';
import { lastLine, mdPlain, orchLine } from './peek';

describe('mdPlain — 시트 살짝 한 줄은 꾸밈 기호 없이', () => {
  it('굵게·기울임·코드·제목·목록·인용', () => {
    expect(mdPlain('### 정리\n- **첫 참모** 자동 *시작*\n> `코드` 한 줄')).toBe('정리 첫 참모 자동 시작 코드 한 줄');
  });
  it('링크는 글자만, 표는 칸 글만', () => {
    expect(mdPlain('[문서](https://x.y) 봐\n| 항목 | 상태 |\n|---|---|\n| A | 끝 |')).toBe('문서 봐 항목 상태 A 끝');
  });
  it('코드 칸 안 별표는 그대로, 곱하기·경로 밑줄도 그대로', () => {
    expect(mdPlain('`a**b` 와 2 * 3 그리고 snake_case_name')).toBe('a**b 와 2 * 3 그리고 snake_case_name');
  });
});

describe('lastLine', () => {
  it('마지막 답을 꾸밈 없이', () => {
    const items = [{ kind: 'user', text: '해 줘' }, { kind: 'assistant', text: '**첫 참모** 켰어' }] as ChatItem[];
    expect(lastLine(items)).toBe('첫 참모 켰어');
  });
});

describe('orchLine — 참모 바꾸기 줄의 상태 한 줄', () => {
  const ts = '2026-10-02T14:00:00Z';
  it('일하는 중이면 마지막 도구, 도구가 없으면 일하는 중', () => {
    const items = [{ kind: 'user', id: 'u', ts, text: '해 줘' }, { kind: 'tools', id: 't', ts, tools: [{ name: 'mcp__playwright__browser_click', target: '저장' }] }] as ChatItem[];
    expect(orchLine(items, 'working')).toBe('일하는 중 · browser_click 저장');
    expect(orchLine([items[0]!], 'working')).toBe('일하는 중');
  });
  it('쉬면 마지막 답을 꾸밈 없이, 기록이 없으면 빈 것', () => {
    expect(orchLine([{ kind: 'assistant', id: 'a', ts, text: '**배포** 끝났어' }] as ChatItem[], 'idle')).toBe('배포 끝났어');
    expect(orchLine([], 'idle')).toBe('');
  });
});
