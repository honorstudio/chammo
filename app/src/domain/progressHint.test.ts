import { describe, expect, it } from 'vitest';
import { capLine, gitLabel, lastSaid, LINE_MAX, maskSecrets, progressHint } from './progressHint';
import type { Activity } from './activity';

const reply = (text: string, ts = '2026-10-31T10:00:00Z', tail?: string): Activity['reply'] => ({ ts, text, ...(tail ? { tail } : {}), turnEnd: true });

describe('maskSecrets — [앱] 줄에 비밀값이 실리지 않게', () => {
  it('키·토큰처럼 생긴 것과 비밀번호 칸 값은 가린다', () => {
    const tok = 'sk-' + 'ant-api03-abcdefghijklmnop1234';
    expect(maskSecrets(`키는 ${tok} 이야`)).not.toContain('abcdefghijklmnop');
    expect(maskSecrets('비밀번호: hunter2!x 로 로그인')).toBe('비밀번호: ••• 로 로그인');
    expect(maskSecrets('password=abc123 저장')).toBe('password=••• 저장');
    expect(maskSecrets('토큰 Ab3dEf5hIj7lMn9pQr1tUv3xYz5bCd7fGh9 붙임')).not.toContain('Ab3dEf');
  });
  it('보통 말·경로·해시는 그대로', () => {
    expect(maskSecrets('테스트 312개 통과, PR #12 올림')).toBe('테스트 312개 통과, PR #12 올림');
    expect(maskSecrets('커밋 3d0b302 · src/app.ts')).toBe('커밋 3d0b302 · src/app.ts');
  });
  it('홈 폴더 앞부분은 ~ 로 줄인다', () => {
    expect(maskSecrets('/home/someone/dev/notes-app/a.ts 고침')).toBe('~/dev/notes-app/a.ts 고침');
  });
});

describe('lastSaid — 대화 끝 두어 문장 + 하던 도구', () => {
  it('턴 끝 답의 마지막 두 문장(꼬리가 있으면 꼬리에서)', () => {
    const a: Activity = { reply: reply('앞부분.', undefined, '시험을 고쳤어. 이제 빌드 돌릴게. 빌드는 3분쯤 걸려.') };
    expect(lastSaid(a)).toEqual(['이제 빌드 돌릴게.', '빌드는 3분쯤 걸려.']);
  });
  it('답 뒤에 부른 도구가 있으면 그 도구 한 줄을 붙인다', () => {
    const a: Activity = { reply: reply('빌드 돌릴게.'), tool: { name: 'Bash', target: 'pnpm build', ts: '2026-10-31T10:01:00Z' } };
    expect(lastSaid(a)).toEqual(['빌드 돌릴게.', '하던 도구: Bash pnpm build']);
  });
  it('답보다 앞선 도구는 안 붙인다 · 대화를 못 읽었으면 빈 목록', () => {
    const a: Activity = { reply: reply('다 했어.'), tool: { name: 'Bash', target: 'ls', ts: '2026-10-31T09:00:00Z' } };
    expect(lastSaid(a)).toEqual(['다 했어.']);
    expect(lastSaid(undefined)).toEqual([]);
  });
  it('긴 문장 하나는 끝쪽을 남겨 자른다', () => {
    const long = '가'.repeat(300);
    const [one] = lastSaid({ reply: reply(long) });
    expect([...one!].length).toBeLessThanOrEqual(91);
    expect(one!.startsWith('…')).toBe(true);
  });
});

describe('gitLabel — 가지@짧은 해시(커밋 안 한 변경 N)', () => {
  it('변경이 있으면 개수, 없으면 가지@해시만, git 이 아니면 빈 글', () => {
    expect(gitLabel({ branch: 'feature/x', sha: 'ab12cd3', changed: 4 })).toBe('feature/x@ab12cd3 (커밋 안 한 변경 4)');
    expect(gitLabel({ branch: 'main', sha: 'ab12cd3', changed: 0 })).toBe('main@ab12cd3');
    expect(gitLabel({ branch: '', sha: '', changed: 0 })).toBe('');
    expect(gitLabel(undefined)).toBe('');
  });
});

describe('progressHint — [앱] 줄 끝에 붙는 한 덩어리', () => {
  const a: Activity = { reply: reply('API 고쳤어. 비밀번호: p4ss 로 확인했어.'), tool: { name: 'Bash', target: 'pnpm test', ts: '2026-10-31T10:05:00Z' } };
  const g = { branch: 'fix/api', sha: 'ab12cd3', changed: 2 };
  it('말·도구·git 을 한 줄로, 비밀값은 가린다', () => {
    const h = progressHint(a, g);
    expect(h).toBe(' · 어디까지: "API 고쳤어. / 비밀번호: ••• 로 확인했어. / 하던 도구: Bash pnpm test" · git fix/api@ab12cd3 (커밋 안 한 변경 2)');
    expect(h).not.toContain('\n');
  });
  it('말을 빼라면(이미 마지막 말이 있는 줄) 도구·git 만', () => {
    expect(progressHint(a, g, { said: false })).toBe(' · 하던 도구: Bash pnpm test · git fix/api@ab12cd3 (커밋 안 한 변경 2)');
  });
  it('아무것도 없으면 빈 글 · 상한을 넘으면 자른다', () => {
    expect(progressHint(undefined, undefined)).toBe('');
    const big: Activity = { reply: reply(Array.from({ length: 20 }, (_, i) => `문장 ${i} ${'나'.repeat(60)}.`).join(' ')) };
    expect([...progressHint(big, g, { max: 120 })].length).toBeLessThanOrEqual(120);
  });
});

describe('capLine — 입력칸 한 줄 상한', () => {
  it('넘으면 끝을 … 로 자르고 줄바꿈은 없앤다', () => {
    expect(capLine('가\n나')).toBe('가 나');
    const out = capLine('x'.repeat(LINE_MAX + 50));
    expect([...out].length).toBe(LINE_MAX);
    expect(out.endsWith('…')).toBe(true);
  });
});
