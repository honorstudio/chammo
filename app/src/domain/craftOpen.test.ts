import { describe, expect, it } from 'vitest';
import { craftFirst, craftFor, craftName, installAsk } from './craftOpen';

describe('어떤 파일은 어느 참모 앱', () => {
  it('편집 앱이 맞는 확장자 — 대소문자·경로 상관없이', () => {
    expect(craftFor('/a/shop logo.AI')).toBe('vectorcraft');
    expect(craftFor('x.eps')).toBe('vectorcraft');
    expect(craftFor('x.svg')).toBe('vectorcraft');
    expect(craftFor('x.psd')).toBe('photocraft');
    expect(craftFor('x.png')).toBe('photocraft');
    expect(craftFor('x.dwg')).toBe('cadcraft');
    expect(craftFor('x.dxf')).toBe('cadcraft'); // 벡터도 열지만 캐드 도면이 먼저
    expect(craftFor('x.xlsx')).toBe('gridcraft');
    expect(craftFor('x.csv')).toBe('gridcraft');
    expect(craftFor('x.docx')).toBe('wordcraft');
    expect(craftFor('x.pptx')).toBe('deckcraft');
    expect(craftFor('x.pdf')).toBe('pdfcraft');
    expect(craftFor('x.fig')).toBe('figcraft');
    expect(craftFor('x.mp4')).toBe('filmcraft');
    expect(craftFor('x.wav')).toBe('soundcraft');
    expect(craftFor('x.designcraft')).toBe('designcraft');
  });

  it('참모 앱이 없는 형식은 null', () => {
    expect(craftFor('a.zip')).toBeNull();
    expect(craftFor('a.md')).toBeNull();
    expect(craftFor('a.hwp')).toBeNull();
    expect(craftFor('Makefile')).toBeNull();
    expect(craftFor('https://x.com/a.ai')).toBeNull(); // 주소는 파일이 아니다
  });

  it('기본 동작 — 스페이스가 제대로 못 보여 주는 것(그림 한 장뿐)만 참모 앱으로, 보이는 건 미리보기', () => {
    for (const f of ['a.ai', 'a.eps', 'a.psd', 'a.dwg', 'a.dxf', 'a.fig', 'a.svgz', 'a.xlsb', 'a.fcproj'] as const) expect(craftFirst(f)).toBe(true);
    // 그림·PDF·영상·소리·엑셀(가운데 표)·워드(글로 바꿔 보기)·슬라이드(쪽 미리보기)·csv(글) — 보기로 충분, 편집은 우클릭·머리 단추
    for (const f of ['a.xlsm', 'a.png', 'a.svg', 'a.pdf', 'a.mp4', 'a.wav', 'a.xlsx', 'a.docx', 'a.pptx', 'a.csv', 'a.zip'] as const) expect(craftFirst(f)).toBe(false);
  });

  it('앱 이름 — 서랍 이름이 오면 그것, 없으면 표', () => {
    expect(craftName('vectorcraft')).toBe('참모 벡터');
    expect(craftName('gridcraft', '참모 표 2')).toBe('참모 표 2');
    expect(craftName('nope')).toBe('nope');
  });

  it('설치 확인 글 — 크기를 알면 붙인다', () => {
    expect(installAsk('참모 벡터', 41 * 1024 * 1024)).toBe('참모 벡터를 설치하고 열까요? (41MB)');
    expect(installAsk('참모 표', null)).toBe('참모 표를 설치하고 열까요?');
  });
});

describe('열기 글', () => {
  it('받침·ㄹ 받침 조사', async () => {
    const { openWithLabel } = await import('./craftOpen');
    expect(openWithLabel('참모 벡터')).toBe('참모 벡터로 열기');
    expect(openWithLabel('참모 필름')).toBe('참모 필름으로 열기');
    expect(openWithLabel('참모 파일')).toBe('참모 파일로 열기');
    expect(openWithLabel('참모 PDF')).toBe('참모 PDF로 열기');
  });
});

describe('우클릭 다르게 열기', () => {
  it('참모 앱이 기본이면 미리보기, 미리보기가 기본이면 참모 앱, 없으면 null', async () => {
    const { altOpen } = await import('./craftOpen');
    expect(altOpen('a.ai')).toEqual({ how: 'preview', label: '미리보기' });
    expect(altOpen('a.xlsx')).toEqual({ how: 'craft', label: '참모 표로 열기' });
    expect(altOpen('a.zip')).toBeNull();
  });
});

describe('scripts/show 와 같은 표', () => {
  it('참모 앱이 기본인 확장자 — show 가 힌트를 내는 표와 같다', async () => {
    const { craftFirstExts, craftFor } = await import('./craftOpen');
    const show = (await import('../../hq-template/scripts/show?raw')).default as string;
    const m = show.match(/CRAFT_FIRST = \{([^}]*)\}/);
    expect(m).toBeTruthy();
    const py = Object.fromEntries([...m![1]!.matchAll(/'([a-z0-9]+)': '([a-z]+)'/g)].map((x) => [x[1], x[2]]));
    expect(Object.keys(py).sort()).toEqual(craftFirstExts());
    for (const [e, app] of Object.entries(py)) expect(craftFor(`x.${e}`)).toBe(app);
  });
});
