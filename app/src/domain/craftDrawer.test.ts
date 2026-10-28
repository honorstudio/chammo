import { describe, expect, it } from 'vitest';
import { craftErr, DRAWER_MEMO_KEY, drawerMemo, drawerView, mergeRows, NO_PYTHON, prefetchingAny, licenseLine, licenseRows, parseNotices, sizeText, splitRows, tileCorner, tileIcon, tileLetter, tileLoading, tileTitle, tileUnavailable, usedLine, usedTotal, type DrawerRow } from './craftDrawer';

const row = (o: Partial<DrawerRow> = {}): DrawerRow => ({ app: 'gridcraft', name: 'GridCraft', what: 'spreadsheets / 표 계산', installed: null, mine: false, size: 0, used: null, latest: '0.7.0', dmgSize: 24580153, icon: '', origName: 'GridCraft', repo: 'github.com/storytold/gridcraft', basedOn: null, chammo: false, ...o });

describe('앱 서랍', () => {
  it('깔린 것과 깔 수 있는 것으로 나눈다', () => {
    const r = splitRows([row({ app: 'a', installed: '1.0' }), row({ app: 'b' })]);
    expect(r.have.map((x) => x.app)).toEqual(['a']);
    expect(r.can.map((x) => x.app)).toEqual(['b']);
  });

  it('올렸을 때 — 깔린 건 판·크기·마지막 사용, 안 깐 건 받을 크기', () => {
    expect(tileTitle(row({ installed: '0.7.0', size: 79 * 1024 * 1024, used: '2026-10-15' }))).toBe('GridCraft · spreadsheets / 표 계산 · 0.7.0 · 79MB · 마지막 사용 2026-10-15');
    expect(tileTitle(row())).toBe('GridCraft · spreadsheets / 표 계산 · 0.7.0 · 받기 23MB');
    expect(tileTitle(row({ installed: '0.6.0', latest: '0.7.0', newer: true }))).toContain('새 판 0.7.0');
    // 깐 판이 더 새것(받아 둔 확인이 묵음·개발판)이면 '새 판'이 아니다 — 판 비교는 scripts/craft 가 숫자로(newer)
    expect(tileTitle(row({ installed: '0.13.5', latest: '0.13.1', newer: false }))).not.toContain('새 판');
  });

  it('기본 앱(미리 받는 다섯)은 이름표에 기본, 뒤에서 받는 중이면 그 칸만 설치 중', () => {
    expect(tileTitle(row({ basic: true }))).toContain('기본 앱');
    expect(tileTitle(row({ basic: true, prefetching: true }))).toContain('미리 받는 중');
    expect(tileTitle(row())).not.toContain('기본');
    expect(prefetchingAny([row(), row({ app: 'pdfcraft', prefetching: true })])).toBe(true);
    expect(prefetchingAny([row({ basic: true })])).toBe(false);
  });

  it('아이콘 — 받은 그림, 없으면 참모 포토는 Chammo 아이콘, 나머지는 빈 칸(첫 글자 판)', () => {
    expect(tileIcon(row({ icon: 'data:image/png;base64,QQ==' }))).toBe('data:image/png;base64,QQ==');
    expect(tileIcon(row({ app: 'photocraft' }))).toBe('/assets/icon-192.png');
    expect(tileIcon(row())).toBe('');
  });

  it('크기 글·합계·첫 글자', () => {
    expect(sizeText(1536 * 1024 * 1024)).toBe('1.5GB');
    expect(sizeText(0)).toBe('');
    expect(usedTotal([row({ size: 10 }), row({ size: 5 })])).toBe(15);
    expect(tileLetter(row({ name: '참모 포토' }))).toBe('포'); // 13개가 다 '참'이면 칸이 안 갈린다 — '참모' 뒤 첫 글자
    expect(tileLetter(row({ name: '참모 PDF' }))).toBe('P');
    expect(tileLetter(row({ name: 'GridCraft' }))).toBe('G');
  });
});

describe('받을 수 없는 칸(10/19 공개 릴리스를 못 받을 때)', () => {
  const why = 'crafts-2026.10.19: could not get the Chammo apps release / 참모 앱 공개 릴리스를 못 받음 — HTTP Error 404: Not Found';
  it('안 깐 칸만 받을 수 없음 — 까닭 한 줄', () => {
    expect(tileUnavailable(row({ latest: null, unavailable: why }))).toBe(why);
    expect(tileUnavailable(row({ installed: '0.8.1', latest: null, unavailable: why }))).toBeNull();
    expect(tileUnavailable(row())).toBeNull();
    expect(tileUnavailable(row({ unavailable: undefined }))).toBeNull();
  });
  it('올리면 받을 수 없음과 까닭', () => {
    expect(tileTitle(row({ latest: null, dmgSize: null, unavailable: why }))).toBe(`GridCraft · spreadsheets / 표 계산 · 받을 수 없음 — ${why}`);
  });
});

describe('서랍 칸 모서리(v7 A1) — 떠 있으면 끄기, 아니면 우리가 깐 것만 지우기', () => {
  it('떠 있는 앱은 전원(지우기 대신), 안 떠 있고 우리가 깐 건 휴지통, 나머진 없음', () => {
    expect(tileCorner(row({ installed: '1.0', mine: true }), true)).toBe('quit');
    expect(tileCorner(row({ installed: '1.0', mine: false }), true)).toBe('quit');
    expect(tileCorner(row({ installed: '1.0', mine: true }), false)).toBe('remove');
    expect(tileCorner(row({ installed: '1.0', mine: false }), false)).toBeNull();
  });
  it('다른 참모가 쓰는 중이면 지우기를 안 띄운다 — 지우기는 모든 인스턴스를 끄고 앱째 지운다(2026-10-21 주인 가르기)', () => {
    expect(tileCorner(row({ installed: '1.0', mine: true }), false, true)).toBeNull();
    expect(tileCorner(row({ installed: '1.0', mine: true }), true, true)).toBe('quit');
  });
});

describe('서랍 먼저 보이기(v8 A2) · 라이선스 창(B1)', () => {
  it('받아야 하는 칸만 자리표시 — 깔렸거나 판을 아는 앱은 바로', () => {
    expect(tileLoading(row({ installed: '1.0', latest: null }), true)).toBe(false);
    expect(tileLoading(row({ installed: null, latest: '0.8.1' }), true)).toBe(false);
    expect(tileLoading(row({ installed: null, latest: null }), true)).toBe(true);
    expect(tileLoading(row({ installed: null, latest: null }), false)).toBe(false); // 다 받은 뒤엔 자리표시 없음
  });
  it('라이선스 줄 — 참모 앱 먼저, 그다음 원본', () => {
    const rows = [row({ app: 'a', name: 'ACraft', chammo: false }), row({ app: 'b', name: '참모 표', chammo: true })];
    expect(licenseRows(rows).map((r) => r.app)).toEqual(['b', 'a']);
  });
  it('고지 파일 절 나누기 — "## 이름 — 라이선스" 와 본문', () => {
    const md = '# Third-party notices\n\nintro\n\n## Univer (spreadsheet) — Apache License 2.0\n\nCopyright X\n\n## zip (Rust crate) — MIT\n\nThe MIT License\n';
    expect(parseNotices(md)).toEqual([
      { name: 'Univer (spreadsheet)', license: 'Apache License 2.0', body: 'Copyright X' },
      { name: 'zip (Rust crate)', license: 'MIT', body: 'The MIT License' },
    ]);
  });
});

describe('라이선스 줄 글', () => {
  it('참모 앱은 원작 이름·판(ChammoBasedOn 문장에서 판만)·저장소 — 문장 모양이 앱마다 달라도 같게', () => {
    expect(licenseLine(row({ chammo: true, origName: 'GridCraft', basedOn: 'Chammo Grid 0.8.0 (github.com/storytold/gridcraft, MIT OR Apache-2.0)' }))).toBe('원작 GridCraft 0.8.0 · github.com/storytold/gridcraft');
    expect(licenseLine(row({ chammo: true, origName: 'GridCraft', basedOn: null }))).toBe('원작 GridCraft · github.com/storytold/gridcraft');
  });
  it('원본은 원본 그대로 + 깔린 판(없으면 새 판)', () => {
    expect(licenseLine(row({ chammo: false, installed: '0.8.0' }))).toBe('원본 그대로 0.8.0 · github.com/storytold/gridcraft');
    expect(licenseLine(row({ chammo: false, installed: null, latest: null }))).toBe('원본 그대로 · github.com/storytold/gridcraft');
  });
});

describe('서랍 크기 줄은 그 기기 이름으로', () => {
  it('맥은 이 맥, 윈도우는 이 PC', () => {
    expect(usedLine(1024 * 1024 * 18, false)).toContain('이 맥에서');
    expect(usedLine(1024 * 1024 * 18, true)).toContain('이 PC 에서');
    expect(usedLine(0, true)).toContain('0MB');
  });
});

describe('서랍 오류 — 파이썬이 없으면 원문 대신 설치 안내(2026-10-21 윈도우 새 PC 0.3.8)', () => {
  it('Rust 가 준 no-python 표시는 설치 안내로(Error 로 와도·앞뒤 공백이 있어도)', () => {
    expect(craftErr(NO_PYTHON)).toEqual({ python: true, text: '참모 앱을 쓰려면 파이썬 3 이 필요해요' });
    expect(craftErr(new Error('no-python')).python).toBe(true);
    expect(craftErr(' no-python\n').python).toBe(true);
  });
  it('다른 오류는 지금처럼 원문 그대로 — 원문 안에 python 이란 말이 있어도 가르지 않는다', () => {
    expect(craftErr('release download failed')).toEqual({ python: false, text: 'release download failed' });
    expect(craftErr('Python was not found; run without arguments to install')).toEqual({ python: false, text: 'Python was not found; run without arguments to install' });
  });
  it('빈 오류(종료 코드만·stderr 없음)는 한 줄 안내로 — 빈 글이면 서랍이 자리표시에 멈췄다(10-28)', () => {
    expect(craftErr('').text).toBe('앱 목록을 못 읽었어요');
    expect(craftErr(new Error('  ')).text).toBe('앱 목록을 못 읽었어요');
  });
});

describe('서랍 기억(10-28 사용자 \'계속 로딩해야 할 이유가 있나\') — 마지막 목록을 바로 그리고 뒤에서 새로 읽는다', () => {
  const mem = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, removeItem: (k: string) => { m.delete(k); }, m }; };
  it('처음엔 기억이 없다 — 그때만 자리표시', () => {
    expect(drawerMemo(mem()).load()).toBeNull();
  });
  it('읽은 목록은 이번 실행(메모리)과 앱 재시작(저장소) 둘 다 남는다', () => {
    const s = mem();
    const a = drawerMemo(s);
    a.save([row({ app: 'a', installed: '1.0' })]);
    expect(a.load()?.map((r) => r.app)).toEqual(['a']);
    expect(drawerMemo(s).load()?.map((r) => r.app)).toEqual(['a']); // 새로 켠 앱
  });
  it('깨진 기록·배열 아닌 기록은 없는 것으로', () => {
    const s = mem();
    s.setItem(DRAWER_MEMO_KEY, '{oops');
    expect(drawerMemo(s).load()).toBeNull();
    s.setItem(DRAWER_MEMO_KEY, '{"app":"a"}');
    expect(drawerMemo(s).load()).toBeNull();
    s.setItem(DRAWER_MEMO_KEY, '[{"name":"x"}]');
    expect(drawerMemo(s).load()).toBeNull();
  });
  it('저장소가 막혀 있어도(던져도) 메모리로는 기억한다', () => {
    const bad = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); }, removeItem: () => {} };
    const a = drawerMemo(bad);
    expect(a.load()).toBeNull();
    a.save([row({ app: 'a' })]);
    expect(a.load()?.map((r) => r.app)).toEqual(['a']);
  });
  it('저장소 없이도(undefined) 돈다', () => {
    const a = drawerMemo(undefined);
    a.save([row()]);
    expect(a.load()).toHaveLength(1);
  });
});

describe('새로 읽은 목록 합치기 — 바뀐 칸만 바꾼다', () => {
  it('하나도 안 바뀌었으면 옛 배열 그대로(다시 그리지 않게)', () => {
    const old = [row({ app: 'a' }), row({ app: 'b' })];
    expect(mergeRows(old, [row({ app: 'a' }), row({ app: 'b' })])).toBe(old);
  });
  it('바뀐 칸만 새 것, 안 바뀐 칸은 옛 것 그대로', () => {
    const old = [row({ app: 'a' }), row({ app: 'b' })];
    const next = mergeRows(old, [row({ app: 'a' }), row({ app: 'b', installed: '1.0' })]);
    expect(next).not.toBe(old);
    expect(next[0]).toBe(old[0]);
    expect(next[1]!.installed).toBe('1.0');
  });
  it('기억이 없으면 새 것 그대로 · 칸 수가 바뀌어도 새 것 순서대로', () => {
    const next = [row({ app: 'a' })];
    expect(mergeRows(null, next)).toBe(next);
    const old = [row({ app: 'a' }), row({ app: 'b' })];
    expect(mergeRows(old, [row({ app: 'b' })]).map((r) => r.app)).toEqual(['b']);
  });
});

describe('서랍 화면 — 자리표시는 기억도 오류도 없을 때만', () => {
  it('목록이 있으면 목록(뒤에서 읽는 중이어도)', () => {
    expect(drawerView([row()], '')).toBe('rows');
    expect(drawerView([row()], '못 읽음')).toBe('rows'); // 옛 목록 + 위에 오류 한 줄
  });
  it('목록이 없고 오류면 오류 한 줄 + 다시 시도 — 자리표시를 계속 두지 않는다', () => {
    expect(drawerView(null, '앱 목록을 못 읽었어요')).toBe('error');
  });
  it('목록도 오류도 없으면(처음 읽는 중) 자리표시', () => {
    expect(drawerView(null, '')).toBe('skeleton');
  });
});
