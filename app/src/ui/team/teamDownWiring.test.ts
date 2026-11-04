// 11-01 사용자 "받는데 어느 정도 되었는지 인디케이터도 없고, 액션도 그렇고" — 시안 승인(받기 아이콘 늘 보임, 막대·멈추기, 폴더에서 보기·열기, 실패 이유 + 다시 받기)
import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { DownActs, DownBar, DownLine, type DownApi } from './TeamDownBits';
import type { TeamDown } from '../../domain/teamDown';
import bits from './RoomBits.tsx?raw';
import convo from './TeamConvo.tsx?raw';
import locker from './TeamLocker.tsx?raw';
import api from '../../data/teamApi.ts?raw';
import css from './team.css?raw';
import downBits from './TeamDownBits.tsx?raw';

const d = (x: Partial<TeamDown>): TeamDown => ({ team: 't', id: 'f', mode: 'save', done: 0, total: 0, state: 'going', why: '', error: '', path: '', ...x });
const fake = {} as DownApi;
const acts = (x?: TeamDown) => renderToStaticMarkup(createElement(DownActs, { d: x, api: fake, onSave: () => {} }));

describe('DownActs — 상태마다 아이콘 하나·둘(글자 단추 없음)', () => {
  it('받기 전 받기 · 받는 중 멈추기 · 다 받음 폴더에서 보기+열기 · 실패 다시 받기', () => {
    expect(acts()).toContain('aria-label="받기"');
    expect(acts(d({ state: 'going' }))).toContain('aria-label="받기 멈추기"');
    const done = acts(d({ state: 'done' }));
    expect(done).toContain('aria-label="폴더에서 보기"');
    expect(done).toContain('aria-label="열기"');
    expect(acts(d({ state: 'failed', why: 'net' }))).toContain('aria-label="다시 받기"');
    for (const h of [acts(), acts(d({ state: 'done' }))]) expect(h).not.toMatch(/>[가-힣A-Za-z]+<\/button>/);
  });
});

describe('DownBar·DownLine', () => {
  it('받는 중에만 막대, 실패 글은 상태 색 클래스', () => {
    expect(renderToStaticMarkup(createElement(DownBar, { d: d({ done: 50, total: 200 }) }))).toContain('width:25%');
    expect(renderToStaticMarkup(createElement(DownBar, { d: d({ state: 'done' }) }))).toBe('');
    expect(renderToStaticMarkup(createElement(DownLine, { d: d({ state: 'failed', why: 'net' }), normal: 'x' }))).toContain('class="tmx-dl-err"');
    expect(renderToStaticMarkup(createElement(DownLine, { normal: '312 MB' }))).toBe('312 MB');
  });
  it('실패 색 한 규칙이 말풍선·카드·줄을 같이 칠한다(말풍선 글 규칙보다 세게)', () => {
    expect(css).toContain('.tmx-file .tmx-dl-err, .tlk-cap .tmx-dl-err, .tmx-lk-row .tmx-dl-err { color: var(--danger-ink); }');
  });
});

describe('배선', () => {
  it('말풍선 받기 아이콘은 단추 밖 겹친 형제(단추 안 단추 금지)', () => {
    expect(bits).toMatch(/<div className=\{`tmx-file-wrap[^`]*`\}>\s*\{body\}\s*<DownActs/);
  });
  it('대화 칸 — 말풍선·오른쪽 클릭 저장이 같은 받기 길, 저장 뒤 저절로 폴더를 열지 않는다', () => {
    expect(convo).toContain('down={fileDown}');
    expect(convo).toContain("{ label: tr('내 폴더에 저장', 'Save to my folder'), sep: true, run: () => saveFile(f) }");
    expect(api).not.toMatch(/team_file_save[^\n]*locker_reveal/);
  });
  it('받기 줄은 앱에 하나 — 대화에서 시작한 받기가 옆 보관함 줄에도(부품마다 따로 읽으면 안 바뀌어 보였다, 하네스 실측)', () => {
    expect(downBits).toContain('subs.add(setList)');
    expect(downBits).toMatch(/let shared: TeamDown\[\] = \[\]/);
    expect(locker).toContain('<DownLine bin d={downs.of(i.id)}');
  });
  it('다 받은 파일이 그새 지워졌으면 열기·폴더에서 보기가 줄을 치워 받기 아이콘으로', () => {
    expect(downBits).toMatch(/team_down_show[^\n]*\.catch\([^\n]*\n\s*void invoke\('team_down_dismiss'/);
  });
  it('보관함 줄·카드 둘 다 받기 아이콘·막대', () => {
    expect(locker.match(/\{downActs\(i\)\}/g)?.length).toBe(2);
    expect(locker).toContain('<DownBar d={downs.of(i.id)} className="tlk-row-bar" />');
    expect(locker).toContain('<DownBar d={downs.of(i.id)} className="tlk-card-bar" />');
  });
});
