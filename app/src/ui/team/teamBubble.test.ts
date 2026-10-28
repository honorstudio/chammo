// 내 말풍선 폭 — DOM 없이 소스로 지킨다(앱 테스트엔 jsdom 이 없다). 실측 하네스는 .shots/dm-agent/bubbles.html
import { describe, expect, it } from 'vitest';
import css from './team.css?raw';

const rule = (sel: string) => css.replace(/\/\*[\s\S]*?\*\//g, '').split('}').map((r) => r.trim()).find((r) => r.split('{')[0]!.split(',').map((s) => s.trim()).includes(sel)) ?? '';

describe('내 말풍선 폭(10-26 — 짧은 말이 두 글자마다 줄바뀜)', () => {
  it('최대 폭(%)은 줄 전체 폭을 아는 칸에 — 내용 폭으로 잡힌 .tmx-col 안 풍선에 % 를 걸면 칸의 82% 만 받아 늘 접힌다', () => {
    expect(rule('.tmx-me > .tmx-col')).toMatch(/max-width:\s*82%/);
    expect(rule('.tmx-col > .tmx-bub.me')).toMatch(/max-width:\s*100%/);
  });
});
