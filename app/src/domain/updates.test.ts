import { describe, expect, it } from 'vitest';
import { appUpdate, claudeBehind, claudeUpdateNote, cmpVer, parseLatestApp, reachableLatest, verLabel, withFeed } from './updates';

describe('cmpVer — 버전 비교', () => {
  it('앞 v·뒤 꼬리 무시, 숫자로', () => {
    expect(cmpVer('2.1.283 (Claude Code)', '2.1.286')).toBeLessThan(0);
    expect(cmpVer('v0.2.10', '0.2.9')).toBeGreaterThan(0);
    expect(cmpVer('0.2.2', 'v0.2.2')).toBe(0);
  });
  it('못 읽으면 0(같다고 봐서 알리지 않는다)', () => {
    expect(cmpVer('?', '2.1.0')).toBe(0);
  });
});

describe('claudeBehind — Claude Code 가 최신보다 옛것이면 최신 번호', () => {
  it('옛것이면 최신 번호, 같거나 새것이면 null', () => {
    expect(claudeBehind('2.1.283 (Claude Code)', '2.1.286')).toBe('2.1.286');
    expect(claudeBehind('2.1.286 (Claude Code)', '2.1.286')).toBeNull();
    expect(claudeBehind('2.1.287', '2.1.286')).toBeNull();
  });
  it('최신을 모르면(오프라인) null', () => {
    expect(claudeBehind('2.1.283', undefined)).toBeNull();
  });
});

describe('parseLatestApp — GitHub 최신 릴리스 응답', () => {
  const rel = {
    tag_name: 'v0.2.3', html_url: 'https://github.com/honorstudio/chammo/releases/tag/v0.2.3', draft: false, prerelease: false,
    assets: [
      { name: 'Chammo_0.2.3_aarch64.dmg', browser_download_url: 'https://github.com/x/Chammo_0.2.3_aarch64.dmg' },
      { name: 'Chammo_0.2.3_x64-setup.exe', browser_download_url: 'https://github.com/x/Chammo_0.2.3_x64-setup.exe' },
    ],
  };
  it('맥은 dmg, 윈도우는 setup.exe 주소', () => {
    expect(parseLatestApp(rel, false)).toEqual({ version: '0.2.3', url: 'https://github.com/x/Chammo_0.2.3_aarch64.dmg', page: rel.html_url });
    expect(parseLatestApp(rel, true)!.url).toBe('https://github.com/x/Chammo_0.2.3_x64-setup.exe');
  });
  it('그 기기 설치 파일이 없으면 릴리스 페이지로', () => {
    expect(parseLatestApp({ ...rel, assets: [rel.assets[0]] }, true)!.url).toBe(rel.html_url);
  });
  it('초안·미리보기·이상한 응답은 null', () => {
    expect(parseLatestApp({ ...rel, draft: true }, false)).toBeNull();
    expect(parseLatestApp({ ...rel, prerelease: true }, false)).toBeNull();
    expect(parseLatestApp({ message: 'API rate limit exceeded' }, false)).toBeNull();
    expect(parseLatestApp(null, false)).toBeNull();
  });
});

describe('appUpdate — 이 앱보다 새 Chammo 가 있으면', () => {
  const latest = { version: '0.2.3', url: 'u', page: 'p' };
  it('새것이면 그대로, 같거나 옛것이면 null', () => {
    expect(appUpdate('0.2.2', latest)).toEqual(latest);
    expect(appUpdate('0.2.3', latest)).toBeNull();
    expect(appUpdate('0.2.4', latest)).toBeNull();
    expect(appUpdate('0.2.2', null)).toBeNull();
  });
});

describe('withFeed — 업데이터가 latest.json 에서 본 새 판을 띠에 합친다', () => {
  const api = { version: '0.4.4', url: 'https://github.com/x/Chammo_0.4.4_x64-setup.exe', page: 'https://github.com/honorstudio/chammo/releases/tag/v0.4.4' };
  const tag = (v: string) => `https://github.com/honorstudio/chammo/releases/tag/v${v}`;
  it('GitHub API 를 못 읽어도(요청 한도·막힘) latest.json 이 새 판을 알면 띠가 뜬다', () => {
    expect(withFeed(null, '0.4.99')).toEqual({ version: '0.4.99', url: tag('0.4.99'), page: tag('0.4.99') });
    expect(appUpdate('0.4.4', withFeed(null, '0.4.99'))?.version).toBe('0.4.99');
  });
  it('latest.json 이 API 보다 새것이면 그 판, 받기 링크는 그 판 릴리스 페이지', () => {
    expect(withFeed(api, '0.4.5')).toEqual({ version: '0.4.5', url: tag('0.4.5'), page: tag('0.4.5') });
  });
  it('같은 판이면 API 가 준 그 기기 설치 파일 주소를 그대로 쓴다', () => {
    expect(withFeed(api, '0.4.4')).toBe(api);
    expect(withFeed(api, 'v0.4.4')).toBe(api);
  });
  it('API 가 더 새것이면 API(latest.json 이 아직 안 올라온 사이)', () => {
    expect(withFeed({ ...api, version: '0.4.6' }, '0.4.5')!.version).toBe('0.4.6');
  });
  it('latest.json 이 새 판이 없다고 하거나 못 읽은 번호면 API 만', () => {
    expect(withFeed(api, null)).toBe(api);
    expect(withFeed(null, null)).toBeNull();
    expect(withFeed(null, 'garbage')).toBeNull();
    expect(withFeed(api, 'garbage')).toBe(api);
  });
});

describe('업데이트 띠 문구 — 괄호가 겹치지 않게', () => {
  it('claude --version 꼬리 "(Claude Code)" 는 떼고 번호만', () => {
    expect(verLabel('2.1.288 (Claude Code)\n')).toBe('2.1.288');
    expect(verLabel('v0.2.3')).toBe('0.2.3');
    expect(verLabel(' 이상한 글 ')).toBe('이상한 글');
  });
  it('재현: 띠 문구에 "(지금 2.1.288 (Claude Code))" 처럼 괄호 안 괄호가 없다', () => {
    const [ko, en] = claudeUpdateNote('2.1.290', '2.1.288 (Claude Code)');
    for (const t of [ko, en]) {
      expect(t).not.toMatch(/\([^)]*\(/);
      expect(t).toContain('2.1.288');
      expect(t).not.toContain('(Claude Code)');
    }
    expect(ko).toBe('Claude Code 2.1.290 이 나왔어요 (지금 2.1.288). 올리면 새로 띄우는 세션부터 새 버전으로 돌아요.');
  });
});

describe('reachableLatest — 이 기기 설치 길로 실제로 받을 수 있는 판과 비교', () => {
  it('재현: winget 은 2.1.302 까지만 있는데 npm 은 2.1.304 — 띠는 2.1.302 기준(2026-10-20 윈도우 시험 PC, 띠가 영영 안 꺼졌다)', () => {
    const latest = reachableLatest({ kind: 'winget', latest: '2.1.302' }, '2.1.304');
    expect(latest).toBe('2.1.302');
    expect(claudeBehind('2.1.302 (Claude Code)', latest)).toBeNull();
    expect(claudeBehind('2.1.292 (Claude Code)', latest)).toBe('2.1.302');
  });
  it('winget·brew 에서 못 읽었으면 안 띄운다(눌러도 못 올리는 띠보다 낫다)', () => {
    expect(reachableLatest({ kind: 'winget', latest: null }, '2.1.304')).toBeUndefined();
    expect(reachableLatest({ kind: 'brew', latest: null }, '2.1.304')).toBeUndefined();
  });
  it('brew 는 cask 판', () => expect(reachableLatest({ kind: 'brew', latest: '2.1.300' }, '2.1.304')).toBe('2.1.300'));
  it('공식 설치(npm)는 npm 최신, 설치 길을 아직 모르면 안 띄운다', () => {
    expect(reachableLatest({ kind: 'npm', latest: null }, '2.1.304')).toBe('2.1.304');
    expect(reachableLatest(null, '2.1.304')).toBeUndefined();
  });
});
