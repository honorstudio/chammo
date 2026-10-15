// 폰 공용 시트(BottomSheet·useSheetDrag, 2026-10-11) — 화면마다 따로 짜던 시트 몸통을 한 벌로. 앱 테스트엔 DOM 이 없어서
// 동작은 domain/sheetGuard 시험 + 하네스 실측(.shots/phone-sheet-kit), 여기선 '모두 공용 시트를 쓰나'와 CSS 규칙을 본다
import { describe, expect, it } from 'vitest';
import css from './mobile.css?raw';

const files = import.meta.glob('./*.{ts,tsx}', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const src = (name: string) => files[`./${name}`] ?? '';
const screens = Object.entries(files).filter(([f]) => !/\.test\.ts$/.test(f) && f !== './BottomSheet.tsx' && f !== './useSheetDrag.ts');
const rule = (sel: string) => {
  const m = new RegExp(`(?:^|\\})\\s*${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`, 'm').exec(css.replace(/\/\*[\s\S]*?\*\//g, ''));
  return m?.[1] ?? '';
};

/** 공용 시트로 옮긴 화면 — 시트 몸통(뒷막·판·끌기)을 직접 안 짠다 */
const MOVED = ['AccountSheet.tsx', 'LoadSheet.tsx', 'PhoneLogin.tsx', 'ComposerExtras.tsx', 'OrchPicker.tsx', 'OrchMenu.tsx', 'ProfileSheet.tsx',
  'FileView.tsx', 'PdfSheet.tsx', 'OfficeSheet.tsx', 'HtmlSheet.tsx', 'SessionPeek.tsx', 'BrowserView.tsx'];
/** 시트 몸통을 직접 짠 흔적 — 뒷막·판 클래스·올라오기 rAF·포털 */
const BODY = /m-pick-wrap|m-pick-back|m-menu-wrap|m-note-back|className="m-view["\s]|requestAnimationFrame\(\(\) => setShown|createPortal/;

describe('공용 시트', () => {
  it('읽었다', () => {
    expect(src('BottomSheet.tsx').length).toBeGreaterThan(500);
    expect(css.length).toBeGreaterThan(1000);
  });
  it('화면 틀 안 시트 자리로 포털 — 키보드 위·참모 색을 틀에서 물려받는다', () => {
    expect(src('BottomSheet.tsx')).toMatch(/createPortal\(node, host\.el\)/);
    expect(src('BottomSheet.tsx')).toMatch(/className="m-sheet-host"/);
    expect(rule('.m-sheet-host')).toMatch(/display:\s*contents/);
  });
  it('끌기·박힘 풀기·진단은 useSheetDrag 한 곳 — 채팅 시트도 같은 훅', () => {
    expect(src('BottomSheet.tsx')).toMatch(/useSheetDrag\(/);
    expect(src('ChatSheet.tsx')).toMatch(/useSheetDrag\(\{[^]*kind: 'chat'/);
    // 공용 밀기 줄(SwipeRow)도 같은 박힘 판단(dragStale)을 쓴다 — 줄 밀기 쪽 공용 하나
    const own = screens.filter(([f, t]) => f !== './SwipeRow.tsx' && /'layout-drag'|dragStale|setPointerCapture/.test(t)).map(([f]) => f);
    expect(own).toEqual([]);
    expect(src('useSheetDrag.ts')).toMatch(/'layout-drag'/);
    expect(src('useSheetDrag.ts')).toMatch(/visibilitychange/);
  });
  it('키보드가 떠 있으면 아래 여백(홈 바 자리)을 빼고, 카드는 틀 안(fixed 면 키보드 뒤로 숨는다)', () => {
    expect(rule('.m-pick-wrap.m-kb .m-pick')).toMatch(/padding-bottom:\s*0/);
    expect(rule('.m-menu-wrap')).toMatch(/position:\s*absolute/);
    expect(rule('.m-menu-wrap.m-kb .m-menu')).toMatch(/margin-bottom:\s*8px/);
  });
  it('스크롤된 칸(목록·프로필 묶음)에서 아래로 쓸면 칸 스크롤 — 손가락 밑 가장 가까운 세로 스크롤 칸이 맨 위일 때만 시트를 끈다', () => {
    expect(src('BottomSheet.tsx')).toMatch(/scrollBox\(t, panel\)/);
    expect(src('BottomSheet.tsx')).toMatch(/overflowY/);
  });
  it('손잡이는 pointer 로 끈다 — 브라우저 스크롤이 가로채지 않게 touch-action none', () => {
    expect(rule('.m-pick-grab')).toMatch(/touch-action:\s*none/);
    expect(src('BottomSheet.tsx')).toMatch(/data-grab/);
  });
  it('옮긴 화면은 BottomSheet 를 쓰고 시트 몸통을 직접 안 짠다', () => {
    for (const f of MOVED) {
      const t = src(f);
      expect(t, f).toMatch(/<BottomSheet/);
      expect(t, f).not.toMatch(BODY);
    }
  });
  it('폰 화면 어디서도 시트 몸통을 직접 짜지 않는다 — 새 시트도 BottomSheet 로', () => {
    expect(screens.filter(([, t]) => BODY.test(t)).map(([f]) => f)).toEqual([]);
  });
  it('알림(가운데 판)도 공용 시트 자리로 — 시트 안에서 띄워도 시트 transform 에 안 갇힌다', () => {
    expect(src('Notice.tsx')).toMatch(/<SheetPortal>/);
    expect(rule('.m-notice-wrap')).toMatch(/position:\s*absolute/);
  });
});

describe('채팅 시트 클래스 .m-sheet 는 채팅 시트만', () => {
  // 엑셀 표(SheetTable)가 같은 .m-sheet 를 써서 그 규칙(gap: 8px)이 채팅 시트에도 붙었다 — 손잡이와 대화·입력줄 사이에 8px 틈,
  // 살짝 높이(손잡이+입력줄을 잼)보다 내용이 8px 커서 입력줄이 화면 아래로 8px 빠졌다(2026-10-12)
  const bare = css.replace(/\/\*[\s\S]*?\*\//g, '');
  it('.m-sheet { … } 맨 규칙은 하나', () => {
    expect(bare.match(/(?:^|\})\s*\.m-sheet\s*\{/gm)?.length).toBe(1);
  });
  it('채팅 시트 말고는 className 에 m-sheet 를 단독으로 안 쓴다', () => {
    const users = Object.entries(files).filter(([f, s]) => !/\.test\.ts$/.test(f) && /className=\{?["`][^"`]*\bm-sheet(?![-\w])/.test(s)).map(([f]) => f);
    expect(users).toEqual(['./ChatSheet.tsx']);
  });
});

describe('다 연 채팅 시트의 손잡이 — 안전 영역 아래', () => {
  // 다 연 시트 윗변이 24 고정이라 손잡이(32)가 다이내믹 아일랜드·상태 막대(위 안전 영역 62) 뒤로 숨어 닫을 길이 안 보였다(2026-10-12 사용자 실기기)
  it('다 열면(키보드 없이) 위 안전 영역에서 윗변 24 를 뺀 만큼 위 여백', () => {
    expect(rule('.m-sheet.m-snap-full')).toMatch(/padding-top:\s*max\(0px,\s*calc\(env\(safe-area-inset-top\)\s*-\s*24px\)\)/);
  });
  it('반·전체 손잡이 줄은 얇게(24) — 누르는 자리는 위로 덧대 44 를 지킨다', () => {
    expect(rule('.m-sheet:not(.m-snap-peek) .m-grab')).toMatch(/min-height:\s*24px/);
    const pad = rule('.m-sheet:not(.m-snap-peek) .m-grab::before');
    expect(pad).toMatch(/top:\s*-16px/);
    expect(pad).toMatch(/height:\s*16px/);
  });
  it('손잡이 줄은 대화 칸보다 위 층', () => {
    expect(rule('.m-grab')).toMatch(/position:\s*relative/);
    expect(rule('.m-grab')).toMatch(/z-index:\s*calc\(var\(--z-base\)\s*\+\s*1\)/);
  });
});
