import { describe, expect, it } from 'vitest';
import view from './ModeView.tsx?raw';
import phone from '../mobile/PhoneModes.tsx?raw';
import web from '../../data/web.ts?raw';

// 모드가 앱 테마(라이트·다크)를 안다(#4) — 앱이 그리기 요청에 지금 테마를 실어 보내고(Rust modes::with_scheme → e.props.scheme),
// 테마가 바뀌면 다시 그린다. 데스크톱은 앱 창 테마, 폰은 폰 화면 테마
describe('데스크톱 모드 칸', () => {
  it('지금 테마를 그리기 요청에 싣는다', () => {
    expect(view).toMatch(/const scheme = useScheme\(\)/);
    expect(view).toMatch(/\('mode_render', \{ name, component, instance, columns, rows, scheme: schemeRef\.current \}\)/);
  });
  it('테마가 바뀌면 띠·칸을 다시 그린다', () => {
    expect(view).toMatch(/useEffect\(\(\) => \{\s*if \(schemeRef\.current === scheme\) return;\s*schemeRef\.current = scheme;\s*redraw\(\);\s*\}, \[scheme, redraw\]\)/);
  });
});

describe('폰 모드 카드', () => {
  it('폰 화면 테마를 mode-view 에 싣고, 바뀌면 다시 받는다', () => {
    expect(web).toMatch(/readModeView = \(name: string, columns: number, rows: number, scheme: 'light' \| 'dark', signal\?: AbortSignal\)/);
    expect(web).toMatch(/&rows=\$\{rows\}&scheme=\$\{scheme\}/);
    expect(phone).toMatch(/const scheme = useScheme\(\)/);
    expect(phone).toMatch(/readModeView\(name, c\.columns, c\.rows, scheme, ctl\.signal\)/);
    expect(phone).toMatch(/\}, \[name, full, scheme\]\);/);
  });
});
