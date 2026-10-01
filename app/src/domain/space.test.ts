import { describe, expect, it } from 'vitest';
import { composeSend, mdDiff } from './space';

describe('mdDiff — 고치기 전·후 마크다운에서 더한 줄·뺀 줄', () => {
  it('더한 줄과 뺀 줄을 순서대로(빈 줄은 무시)', () => {
    const before = '# 할 일\n\n- [ ] 로그인 화면\n- [ ] 알림 문구 다듬기\n';
    const after = '# 할 일\n\n- [x] 로그인 화면\n- [ ] 알림 문구 다듬기\n- [ ] 스페이스 기획 v3\n';
    expect(mdDiff(before, after)).toEqual({ added: ['- [x] 로그인 화면', '- [ ] 스페이스 기획 v3'], removed: ['- [ ] 로그인 화면'] });
  });
  it('같은 줄이 여러 번이면 개수로 센다', () => {
    expect(mdDiff('a\na\nb', 'a\nb')).toEqual({ added: [], removed: ['a'] });
  });
  it('바뀐 게 없으면 둘 다 빈 목록', () => {
    expect(mdDiff('a\n\nb', 'a\nb\n')).toEqual({ added: [], removed: [] });
  });
});

describe('composeSend — 참모에게 보낼 글(여러 문서를 모아서 한 번에)', () => {
  it('문서마다 더한 줄(+)·뺀 줄(-), 끝에 메모', () => {
    const t = composeSend([{ path: '/Users/me/dev/project-a/docs/starter.md', diff: { added: ['- [ ] 알림 문구 다듬기'], removed: ['- [ ] 옛 할 일'] } }], '이건 내가 정할게');
    expect(t).toBe([
      '[스페이스] 사용자가 고친 것',
      '■ starter.md (/Users/me/dev/project-a/docs/starter.md)',
      '+ - [ ] 알림 문구 다듬기',
      '- - [ ] 옛 할 일',
      '메모: 이건 내가 정할게',
    ].join('\n'));
  });
  it('바뀐 게 없는 문서는 빼고, 메모가 없으면 메모 줄도 없다', () => {
    const t = composeSend([
      { path: '/a/x.md', diff: { added: [], removed: [] } },
      { path: '/a/y.md', diff: { added: ['새 줄'], removed: [] } },
    ], '  ');
    expect(t).toBe(['[스페이스] 사용자가 고친 것', '■ y.md (/a/y.md)', '+ 새 줄'].join('\n'));
  });
  it('한 문서에 30줄 넘게 바뀌면 줄이고 몇 줄 더 있는지 적는다', () => {
    const added = Array.from({ length: 35 }, (_, i) => `줄 ${i}`);
    const t = composeSend([{ path: '/a/big.md', diff: { added, removed: [] } }], '');
    expect(t.split('\n')).toHaveLength(2 + 30 + 1);
    expect(t).toContain('… 5줄 더 — 파일에서 보기');
  });
  it('보낼 게 없으면 빈 글', () => {
    expect(composeSend([{ path: '/a/x.md', diff: { added: [], removed: [] } }], '')).toBe('');
  });
});

describe('composeSend — 줄 코멘트(2026-09-30 사용자: 위 메모 한 줄로는 줄마다 말을 못 단다)', () => {
  it('문서마다 고친 것 아래 코멘트(인용한 줄 → 코멘트)', () => {
    const t = composeSend(
      [{ path: '/a/x.md', diff: { added: ['새 줄'], removed: [] } }],
      '',
      [{ path: '/a/x.md', quote: '둘째 할 일', text: '이건 다음 주로' }, { path: '/a/y.md', quote: '제목', text: '더 짧게' }],
    );
    expect(t).toBe([
      '[스페이스] 사용자가 고친 것',
      '■ x.md (/a/x.md)',
      '+ 새 줄',
      '  > 둘째 할 일 → 이건 다음 주로',
      '■ y.md (/a/y.md)',
      '  > 제목 → 더 짧게',
    ].join('\n'));
  });
  it('인용이 길면 40자에서 자른다', () => {
    const t = composeSend([], '', [{ path: '/a/x.md', quote: '가'.repeat(60), text: '짧게' }]);
    expect(t).toContain(`  > ${'가'.repeat(40)}… → 짧게`);
  });
});

describe('mdDiff — 띄어쓰기만 다른 줄은 같은 줄(편집기가 인용문 ">  " 로 바꿔 저장해 안 고친 줄이 뺌·더함으로 왔다, 2026-09-30)', () => {
  it('공백 개수·목록 기호(- ↔ *) 차이는 무시', () => {
    expect(mdDiff('> **바뀌지 않는 것** — 글자', '>  **바뀌지 않는 것** — 글자')).toEqual({ added: [], removed: [] });
    expect(mdDiff('- 할 일 하나', '* 할 일 하나')).toEqual({ added: [], removed: [] });
  });
  it('글자가 바뀌면 그대로 잡는다', () => {
    expect(mdDiff('끝났다.', '끝났다')).toEqual({ added: ['끝났다'], removed: ['끝났다.'] });
  });
});
