// 폰 받기(11-12 사용자 "모바일에서 공유 버튼은 있는데 다운로드 버튼이 없다") — 단추가 어디에 보이나를 소스로 지킨다(앱 테스트엔 jsdom 이 없다)
import { describe, expect, it } from 'vitest';
import save from './ShareButton.tsx?raw';
import viewer from './ImageViewer.tsx?raw';
import locker from './PhoneTeamLocker.tsx?raw';
import roomFiles from './PhoneRoomFiles.tsx?raw';
import video from './TeamVideoSheet.tsx?raw';
import review from './VideoReviewSheet.tsx?raw';
import team from './PhoneTeam.tsx?raw';
import fileView from './FileView.tsx?raw';
import pdf from './PdfSheet.tsx?raw';
import html from './HtmlSheet.tsx?raw';
import office from './OfficeSheet.tsx?raw';
import web from '../../data/web.ts?raw';

describe('받기와 공유는 따로 — 받기 = 사파리 다운로드(파일 앱), 공유 = 공유 시트', () => {
  it('받기 단추는 내려받기 아이콘 + 이름표 "받기", 공유 시트를 안 부른다', () => {
    const dl = save.slice(save.indexOf('export function DownloadButton'), save.indexOf('export function ShareButton'));
    expect(dl).toContain('<IconDownload />');
    expect(dl).toContain("tr('받기', 'Download')");
    expect(dl).not.toMatch(/navigator\.share/);
    expect(dl).toMatch(/download\(/);
  });
  it('공유 단추는 이름표가 "공유" — 예전 "폰으로 받기"(공유 아이콘인데 받기라고 읽혔다)는 없다', () => {
    expect(save).toContain("tr('공유', 'Share')");
    expect(save).not.toContain('폰으로 받기');
  });
  it('둘 다 맥 파일(path)과 팀 파일(team) 두 길을 받는다 — 팀은 맥이 받아 푸는 동안 기다린다(waitTeamDl)', () => {
    expect(save).toMatch(/dlTicket\(/);
    expect(save).toMatch(/teamDl\(/);
    expect(save).toMatch(/waitTeamDl\(/);
    expect(web).toContain("'/api/team-dl'");
  });
  it('단추 쌍(SaveButtons)은 받기가 앞, 공유가 뒤', () => {
    const pair = save.slice(save.indexOf('export function SaveButtons'));
    expect(pair.indexOf('<DownloadButton')).toBeGreaterThan(0);
    expect(pair.indexOf('<DownloadButton')).toBeLessThan(pair.indexOf('<ShareButton'));
  });
});

describe('단추가 보이는 자리', () => {
  it('개인 파일 보기 머리 다섯 곳 모두 받기·공유 쌍', () => {
    for (const [n, s] of [['FileView', fileView], ['PdfSheet', pdf], ['HtmlSheet', html], ['OfficeSheet', office]] as const) expect(s, n).toContain('<SaveButtons path={path}');
    expect(viewer).toContain('<SaveButtons');
  });
  it('그림 보기는 맥 파일이거나 팀 파일일 때 — 팀 그림 보기 머리에도', () => {
    expect(viewer).toContain('{(path || team) && <SaveButtons');
    expect(team).toMatch(/<ImageViewer[^>]*team=\{\{ team: zoom\.team, id: zoom\.id \}\}/);
  });
  it('팀 보관함 길게 누르기 메뉴 — 받을 수 있는 파일(phoneSaveable)이면 메뉴 머리에 쌍', () => {
    expect(locker).toContain('phoneSaveable(menu.item, trash)');
    expect(locker).toMatch(/actions=\{[^}]*<SaveButtons team=/);
  });
  it('대화 파일 목록 — 길게 누르면(또는 볼 길이 없는 줄을 누르면) 받기·공유 메뉴', () => {
    expect(roomFiles).toContain('usePress(');
    expect(roomFiles).toContain('<SaveButtons team=');
    expect(roomFiles).toContain('phoneSaveable(');
  });
  it('팀 영상 — 받는 중 화면과 다 받은 영상 검토 머리 둘 다', () => {
    expect(video).toContain('<SaveButtons team=');
    expect(review).toContain('extra');
    expect(video).toMatch(/<VideoReviewSheet[^>]*extra=/);
  });
});
