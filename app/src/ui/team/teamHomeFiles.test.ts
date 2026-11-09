// 폰 팀 파일 누르기(11-01 사용자 "팀 홈 최근 파일 줄을 눌러도 아무 일이 없다, 맥에선 열림") — DOM 없이 소스로 지킨다(앱 테스트엔 jsdom 이 없다)
import { describe, expect, it } from 'vitest';
import blocks from './HomeBlocks.tsx?raw';
import home from './TeamHome.tsx?raw';
import bits from './RoomBits.tsx?raw';
import phone from '../mobile/PhoneTeam.tsx?raw';
import locker from '../mobile/PhoneTeamLocker.tsx?raw';
import web from '../../data/web.ts?raw';
import domain from '../../domain/teamHome.ts?raw';
import sources from '../../data/teamHomeApi.ts?raw';
import teamApi from '../../data/teamApi.ts?raw';

describe('폰 팀 홈 최근 파일 — 볼 수 있는 파일만 누르면 보기', () => {
  it('폰 블록 출처가 openFile 을 준다 — 전엔 없어서 줄이 그냥 div 였다', () => {
    expect(phone).toMatch(/homeSources: HomeSources = useMemo\(\(\) => \(\{[\s\S]*openFile: \(team, i\) => openPic\(team, i\)/);
    expect(phone).toMatch(/canOpen: \(i\) => !!phoneView\(i\)/);
  });
  it('블록은 canOpen 이 아니라고 한 줄은 누를 수 있게 그리지 않는다(문서·엑셀)', () => {
    expect(domain).toContain('canOpen?: (i: LockerItem) => boolean');
    expect(home).toContain('canOpen: sources.canOpen');
    expect(blocks).toContain('d.openFile && (d.canOpen?.(i) ?? true)');
  });
  it('보기는 팀 홈·보관함에서도 뜬다 — 대화 화면 밖에도 ImageViewer', () => {
    expect(phone.match(/\{viewer\}/g)?.length).toBe(2);
    expect(phone).toContain('load={teamFileView(zoom.team, zoom.id, zoom.kind)}');
  });
});

describe('폰 팀 보관함 줄 — 톡 = 보기(볼 수 있으면), 길게 = 메뉴', () => {
  it('볼 수 있는 줄은 누르면 연다, 아니면 전처럼 메뉴', () => {
    expect(locker).toContain('const open = !trash && onOpen && phoneView(item) ? () => onOpen(item) : onMenu;');
    expect(locker).toContain('usePress(open, onMenu)');
    expect(phone).toContain('onOpen={(i) => openPic(view.teamId, i)}');
  });
});

describe('폰 팀 대화 PDF 칸 — 썸네일과 상관없이 누르면 보기', () => {
  it('PDF 칸도 버튼(열 수 있는 파일이면)', () => {
    expect(bits).toContain('onOpen && (!canOpen || canOpen(f))');
  });
  it('PDF 는 썸네일 길 큰 판(1600)으로 — 그림 길은 PDF 를 거절한다', () => {
    expect(web).toContain('/api/team-file-thumb?team=${encodeURIComponent(team)}&id=${encodeURIComponent(id)}&size=1600');
  });
});

describe('팀 홈 최근 파일·폰 팀 보관함 줄 — 확장자 네모 자리에 첫 장(11-01 시안 2)', () => {
  it('블록 출처가 썸네일 길을 준다 — 데스크톱은 teamFileThumb, 폰은 그릴 수 있는 것만 맥이 줄인 JPEG', () => {
    expect(domain).toContain('thumb?: (team: string, i: LockerItem) => Promise<string | null>');
    // 홈 줄은 이미 풀어 둔 판만(망 안 탐) — 홈을 열 때마다 내려받기가 붙지 않게(11-01 성능 관문)
    expect(sources).toContain('thumb: (team, i) => teamPeekedThumb(team, i)');
    expect(teamApi).toContain("invoke<string | null>('team_locker_peeked', { team, id: i.id, at: i.at })");
    expect(phone).toMatch(/thumb: \(team, i\) => \(thumbKind\(i\.name, i\.size\) && !i\.why \? teamThumbBlob\(team, i\.id, i\.at\) : Promise\.resolve\(null\)\)/);
    expect(web).toContain('&size=360${at !== undefined ? `&at=${at}` : \'\'}');
    expect(home).toContain('thumb: sources.thumb');
  });
  it('줄은 FileMini — 그림이 오면 작은 첫 장, 못 그리면 확장자 그대로', () => {
    expect(bits).toContain('export function FileMini(');
    expect(blocks).toContain('<FileMini');
    expect(locker).toContain('<FileMini');
  });
});
