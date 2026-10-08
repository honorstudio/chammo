import { describe, expect, it } from 'vitest';
import { accessBanner, copiesNote, wizardAccess, FULL_DISK_URL, type Access, type Copies } from './access';
import { canNext, type EnvCheck } from './setup';

const a = (state: Access['state'], dir = '/Users/me/Desktop/dev', prot = true): Access => ({ state, dir, protected: prot, detail: '' });

describe('프로젝트 폴더 읽기 띠 — 앱을 새로 깔거나 이름을 바꾸면 맥 권한이 풀려 세션이 Unexpected 로만 실패했다(이슈 #1)', () => {
  it('맥이 막았으면(EPERM) 설정 열기 띠', () => expect(accessBanner(a('denied'))).toEqual({ kind: 'mac', dir: '/Users/me/Desktop/dev' }));
  it('파일 권한이면 버튼 없는 띠', () => expect(accessBanner(a('noPerm', '/srv/dev', false))).toEqual({ kind: 'perm', dir: '/srv/dev' }));
  it('잘 읽히거나·없거나·권한 창 대기·못 읽음(모름)이면 띄우지 않는다', () => {
    for (const s of ['ok', 'missing', 'pending', 'error'] as const) expect(accessBanner(a(s))).toBeNull();
    expect(accessBanner(null)).toBeNull();
  });
  it('닫은 폴더는 다시 안 띄운다(다른 폴더로 바뀌면 띄운다)', () => {
    expect(accessBanner(a('denied'), '/Users/me/Desktop/dev')).toBeNull();
    expect(accessBanner(a('denied'), '/Users/me/other')).not.toBeNull();
  });
  it('설정 딥링크는 전체 디스크 접근 권한', () => expect(FULL_DISK_URL).toBe('x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles'));
});

describe('마법사 기본 설정 — 고른 프로젝트 폴더를 실제로 읽어 본다', () => {
  const ok = { claudePath: '/c', loggedIn: true, clt: true } as unknown as EnvCheck;
  const trust = { dev: true, hq: true };
  it('막혔거나 권한 창 답을 기다리면 다음으로 못 간다', () => {
    expect(wizardAccess(a('denied'))).toEqual({ block: true, kind: 'mac' });
    expect(wizardAccess(a('noPerm'))).toEqual({ block: true, kind: 'perm' });
    expect(wizardAccess(a('pending'))).toEqual({ block: true, kind: 'pending' });
    expect(canNext('basics', ok, trust, a('denied'))).toBe(false);
    expect(canNext('basics', ok, trust, a('pending'))).toBe(false);
  });
  it('읽히거나 아직 없는 폴더(시작하기에서 만든다)·못 읽음(모름)이면 막지 않는다', () => {
    for (const s of ['ok', 'missing', 'error'] as const) expect(wizardAccess(a(s)).block).toBe(false);
    expect(canNext('basics', ok, trust, a('ok'))).toBe(true);
    expect(canNext('basics', ok, trust, null)).toBe(true); // 점검 전(첫 그림) — 믿기만 보던 예전과 같다
    expect(canNext('basics', ok, trust)).toBe(true);
  });
});

describe('같은 앱 여러 벌 — 알리기만, 자동으로 끄지 않는다', () => {
  const none: Copies = { running: [], installed: [], fromDmg: false };
  it('혼자면 없음', () => expect(copiesNote(none)).toBeNull());
  it('또 떠 있으면 그 경로·버전, 열쇠는 경로+번호(같은 걸 닫으면 다시 안 뜬다)', () => {
    const c: Copies = { ...none, running: [{ path: '/Applications/Chammo 2.app', version: '0.1.4', pid: 20 }] };
    const n = copiesNote(c)!;
    expect(n.running).toEqual(['/Applications/Chammo 2.app (0.1.4)']);
    expect(copiesNote(c, n.key)).toBeNull();
    // 다른 번호로 또 뜨면 다시 알린다
    expect(copiesNote({ ...c, running: [{ ...c.running[0]!, pid: 21 }] }, n.key)).not.toBeNull();
  });
  it('깔린 것·dmg 실행도 알린다, 버전 모르면 경로만', () => {
    const n = copiesNote({ running: [], installed: [{ path: '/Applications/Chammo 2.app', version: '', pid: null }], fromDmg: true })!;
    expect(n.installed).toEqual(['/Applications/Chammo 2.app']);
    expect(n.fromDmg).toBe(true);
  });
  it('못 읽었으면 없음', () => expect(copiesNote(null)).toBeNull());
});
