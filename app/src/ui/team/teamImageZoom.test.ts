// 팀 대화 그림 크게 보기(11-01 사용자 "캡처.JPG 칸을 눌러도 크게 안 보인다") — DOM 없이 소스로 지킨다(앱 테스트엔 jsdom 이 없다)
import { describe, expect, it } from 'vitest';
import convo from './TeamConvo.tsx?raw';
import bits from './RoomBits.tsx?raw';
import phone from '../mobile/PhoneTeam.tsx?raw';
import viewer from '../mobile/ImageViewer.tsx?raw';
import web from '../../data/web.ts?raw';

describe('폰 팀 대화 — 그림 칸을 누르면 화면 가득 보기', () => {
  it('폰도 그림 칸에 누르기를 넘긴다 — 전엔 rich(데스크톱)일 때만 onOpen 이라 폰 그림 칸은 그냥 div 였다', () => {
    expect(convo).toContain('onOpen={rich ? (f) => openFile(f) : viewImage}');
    expect(convo).toContain('canOpen={rich ? undefined : (f: TeamFile) => !!phoneView(f)}');
  });
  it('폰은 열 수 있는 파일 칸만 버튼 — 열 길이 없는 칸(zip 등)은 누를 수 있게 보이지 않는다', () => {
    expect(bits).toContain('onOpen && (!canOpen || canOpen(f))');
  });
  it('폰 팀 화면이 ImageViewer 를 띄우고, 잠긴 그림은 맥이 풀어 준 것(/api/team-file-image)으로', () => {
    expect(phone).toContain('viewImage={(f: TeamFile) => openPic(f.team || view.teamId, f)}');
    expect(phone).toContain('<ImageViewer');
    expect(web).toContain('return (original) => teamFileImage(team, id, original)');
    expect(phone).toContain('load={teamFileView(zoom.team, zoom.id, zoom.kind)}');
    expect(web).toContain('/api/team-file-image?team=');
    expect(web).toMatch(/original \? '' : '&view=1'/);
  });
  it('ImageViewer 는 받는 길을 갈아 끼울 수 있다 — 맥 파일(경로)이나 팀 파일일 때 받기·공유 단추(11-12)', () => {
    expect(viewer).toContain('load = (original: boolean) => fileImage(path!, original)');
    expect(viewer).toContain('{(path || team) && <SaveButtons');
  });
  it('보기는 시트 자리(SheetPortal)로 띄운다 — 팀 칸(.tmh) 안 transform 에 갇히지 않게', () => {
    expect(viewer).toContain('<SheetPortal>');
  });
});
