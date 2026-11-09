// 폰 DM 파일(11-06 사용자 "디엠 온 거 파일 볼 수가 없음·썸네일이 안 보인다·DM 보관함을 모바일에서 못 봄") — DOM 없이 소스로 지킨다(앱 테스트엔 jsdom 이 없다)
import { describe, expect, it } from 'vitest';
import convo from '../team/TeamConvo.tsx?raw';
import bits from '../team/RoomBits.tsx?raw';
import phone from './PhoneTeam.tsx?raw';
import docSheet from './TeamDocSheet.tsx?raw';
import roomFiles from './PhoneRoomFiles.tsx?raw';
import locker from './PhoneTeamLocker.tsx?raw';
import web from '../../data/web.ts?raw';

describe('폰 썸네일 — 한꺼번에 안 나간다', () => {
  it('대화 썸네일은 줄(동시에 둘, busy 면 다시)을 지난다', () => {
    expect(web).toContain('const thumbTurn = thumbLine(2)');
    expect(web).toMatch(/thumbTurn\(\(\) => call\(`\/api\/team-file-thumb/);
  });
  it('폰 말풍선은 화면에 들어온 칸만 받는다 — 파일 97개 대화를 열 때 다 내려받지 않게', () => {
    expect(convo).toContain('lazy={!rich}');
    expect(bits).toContain('new IntersectionObserver');
    expect(bits).toContain("el.closest('.tmx-msgs')");
    expect(bits).toMatch(/if \(!kind \|\| !thumb \|\| !seen\) return;/);
  });
  it('폰 보관함 줄도 화면에 들어온 칸만', () => {
    expect(locker).toMatch(/<FileMini[^>]* lazy /);
    expect(roomFiles).toMatch(/<FileMini[^>]* lazy /);
  });
});

describe('폰 DM 파일 열기', () => {
  it('열 수 있는 파일은 썸네일을 기다리지 않고 누른다 — 전엔 썸네일이 뜬 칸만 버튼이었다', () => {
    expect(convo).toContain('canOpen={rich ? undefined : (f: TeamFile) => !!phoneView(f)}');
    expect(bits).toContain('onOpen && (!canOpen || canOpen(f))');
    expect(bits).not.toContain('onlyPics');
  });
  it('문서는 맥이 풀어 준 자리를 받아 폰 보기(FileView)로 — 실패면 까닭과 다시', () => {
    expect(phone).toContain("zoom.kind === 'doc'");
    expect(phone).toContain('<TeamDocSheet');
    expect(docSheet).toContain('teamDocPath(team, id)');
    expect(docSheet).toContain('<FileView path={st.path}');
    expect(docSheet).toContain('<IconRefresh />');
    expect(web).toContain('/api/team-file-open?team=');
  });
});

describe('폰 DM 보관함', () => {
  it('대화 머리 폴더 아이콘 — 방이 있을 때만, 데스크톱과 같은 목록(inRoom)', () => {
    expect(phone).toContain('onFiles={cur.room ? () => setRoomFiles(cur.room) : undefined}');
    expect(phone).toContain('<PhoneRoomFiles');
    expect(roomFiles).toContain('inRoom(v.items, room)');
    expect(roomFiles).toContain('api.locker(team, 0)');
  });
  it('볼 수 있는 줄만 버튼, 썸네일은 맥이 줄인 것', () => {
    expect(roomFiles).toContain('phoneView(i)');
    expect(roomFiles).toContain('teamThumbBlob(team, i.id)');
  });
  it('뒤로 나가면 닫힌다', () => {
    expect(phone).toContain('back={() => { setZoom(null); setRoomFiles(null); setSel(null); }}');
  });
});
