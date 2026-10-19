import { describe, expect, it } from 'vitest';
import { licenseLine, licenseRows, parseNotices, sizeText, splitRows, tileCorner, tileIcon, tileLetter, tileLoading, tileTitle, tileUnavailable, usedTotal, type DrawerRow } from './craftDrawer';

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
    expect(tileTitle(row({ installed: '0.6.0', latest: '0.7.0' }))).toContain('새 판 0.7.0');
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
