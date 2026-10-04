import { describe, expect, it } from 'vitest';
import { appUpdate, claudeBehind, claudeUpdateNote, cmpVer, parseLatestApp, verLabel } from './updates';

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
