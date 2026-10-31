// 폰 기기 줄 — 첫 단추 '이 맥'이 무슨 뜻인지 안 읽혔다(2026-10-23 사용자). 이 컴퓨터 이름(폰 서버 /api/env deviceName)을 짝지은 기기 이름과 나란히,
// 줄 위엔 '기기' 제목. 그 기기 보는 중 줄의 '이 맥' 글 단추는 끝내기(X) 아이콘 — 이름표에 어디로 돌아가는지
import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { FarPills, selfDevice } from './PhoneFar';
import far from './PhoneFar.tsx?raw';
import picker from './OrchPicker.tsx?raw';
import { envFromCache } from '../../domain/boot';

const devs = [{ id: 'nIMAC', name: 'office-imac' }];

describe('폰 기기 줄 — 이 컴퓨터 이름', () => {
  it('이름이 있으면 그 이름, 없으면(옛 서버) 이 맥', () => {
    expect(selfDevice('Studio Mac')).toBe('Studio Mac');
    expect(selfDevice('  ')).toBe('이 맥');
    expect(selfDevice(undefined)).toBe('이 맥');
    expect(selfDevice(null)).toBe('이 맥');
  });
  it('첫 단추 = 이 컴퓨터 이름, 줄 위 기기 제목', () => {
    const html = renderToStaticMarkup(createElement(FarPills, { devices: devs, cur: null, self: 'Studio Mac', onPick: () => {} }));
    expect(html).toMatch(/class="m-sect[^"]*">기기</);
    expect(html).toMatch(/m-far-pill on"[^>]*>Studio Mac</);
    expect(html).not.toContain('이 맥');
  });
  it('짝지은 기기가 없으면 줄도 제목도 없다', () => {
    expect(renderToStaticMarkup(createElement(FarPills, { devices: [], cur: null, self: 'x', onPick: () => {} }))).toBe('');
  });
  it('기기 줄을 쓰는 두 곳 다 이 컴퓨터 이름을 넘긴다', () => {
    expect(picker).toMatch(/<FarPills [^>]*self=\{/);
    expect(far.match(/<FarPills [^>]*self=\{/g)?.length).toBe(1);
  });
  it('기기 줄이 있으면 참모 목록 위에도 제목(답을 기다림이 없을 때도) — 기기 단추와 참모 줄이 섞여 보이지 않게', () => {
    expect(picker).toContain('{!waiting.length && far && <div className="m-sect">{title}</div>}');
  });
  it('보는 중 줄의 돌아가기는 글 대신 끝내기 아이콘 + 어디로 가는지 이름표', () => {
    const back = far.split('\n').find((l) => l.includes('className="m-far-back"')) ?? '';
    expect(back).toContain("aria-label={tr(`${josa(selfDevice(self), '으로', '로')} 돌아가기`, `Back to ${selfDevice(self)}`)}");
    expect(back).toContain('<IconClose />');
    expect(back).not.toContain('`이 ${machine()}`');
  });
  it('기억해 둔 맥 정보에 이 컴퓨터 이름도 남는다(다음 켜기 첫 화면부터)', () => {
    const env = { assistantName: '참모', language: 'ko', devRoot: '/d', extraProjects: [], hqDir: '/h', deviceName: 'Studio Mac' };
    expect(envFromCache(JSON.stringify(env))).toEqual(env);
  });
});

import css from './mobile.css?raw';
describe('그 기기 보는 중 줄', () => {
  const rule = (sel: string) => css.match(new RegExp(`\\n${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\{([^}]*)\\}`))?.[1] ?? '';
  it('홈 화면 앱에서 시계·노치 밑으로 안 들어간다 — 위 안전 영역만큼', () => expect(rule('.m-far-bar')).toMatch(/padding: env\(safe-area-inset-top\)/));
  it('긴 기기 이름은 말줄임(돌아가기 단추를 밀어내지 않게)', () => expect(rule('.m-far-bar b')).toMatch(/text-overflow: ellipsis/));
  it('돌아가기 단추 누름 칸 44', () => { expect(rule('.m-far-back')).toMatch(/width: 44px/); expect(rule('.m-far-back')).toMatch(/height: 44px/); });
});
