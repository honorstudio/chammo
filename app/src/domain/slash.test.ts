import { describe, expect, it } from 'vitest';
import { completeSlash, matchSlash, slashQuery, type SlashItem } from './slash';

describe('slashQuery — 지금 / 명령 이름을 치는 중인가', () => {
  it('맨 앞 / 뒤 첫 단어를 치는 중이면 그 글자', () => {
    expect(slashQuery('/', 1)).toBe('');
    expect(slashQuery('/mo', 3)).toBe('mo');
    expect(slashQuery('/project-st', 11)).toBe('project-st');
  });
  it('띄어쓰기 뒤(인자)·맨 앞이 / 가 아니면·커서가 이름 밖이면 null', () => {
    expect(slashQuery('/model opus', 11)).toBeNull();
    expect(slashQuery('안녕 /mo', 7)).toBeNull();
    expect(slashQuery('/mo', 0)).toBeNull();
    expect(slashQuery('', 0)).toBeNull();
    expect(slashQuery('/mo\n다음 줄', 3)).toBe('mo');
    expect(slashQuery('/mo\n다음 줄', 7)).toBeNull();
  });
});

const items: SlashItem[] = [
  { name: 'model', desc: '모델 바꾸기', kind: 'builtin' },
  { name: 'compact', desc: '대화 요약', kind: 'builtin' },
  { name: 'clear', desc: '대화 비우기', kind: 'builtin' },
  { name: 'project-starter', desc: '프로젝트 하네스', kind: 'skill' },
  { name: 'code-review', desc: '리뷰', kind: 'skill' },
];

describe('matchSlash — 거르기', () => {
  it('앞글자 맞는 것 먼저, 그다음 가운데 맞는 것', () => {
    expect(matchSlash(items, 'c').map((i) => i.name)).toEqual(['compact', 'clear', 'code-review', 'project-starter']);
    expect(matchSlash(items, 'review').map((i) => i.name)).toEqual(['code-review']);
  });
  it('빈 글자면 전부(최대 개수까지), 대소문자 무시', () => {
    expect(matchSlash(items, '').length).toBe(5);
    expect(matchSlash(items, 'MO').map((i) => i.name)).toEqual(['model']);
    expect(matchSlash(items, '', 2).length).toBe(2);
  });
  it('같은 이름이 둘이면(기본 명령과 스킬) 앞의 것 하나만', () => {
    expect(matchSlash([...items, { name: 'model', desc: 'x', kind: 'skill' }], 'model')).toHaveLength(1);
  });
});

describe('completeSlash — Tab 으로 채우기', () => {
  it('첫 줄 명령 이름을 바꾸고 뒤에 한 칸, 다음 줄은 그대로', () => {
    expect(completeSlash('/mo', 'model')).toBe('/model ');
    expect(completeSlash('/mo\n둘째 줄', 'model')).toBe('/model \n둘째 줄');
  });
});
