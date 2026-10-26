// 팀 파일 열기(보관함 줄·대화 파일 풍선 공용, 10-26 사용자) — Rust 가 데이터 폴더 자리(team-locker-peek)에 풀고,
// 스페이스가 그리는 형식이면 scripts/show 와 같은 길(openChatFile — 채팅 뷰는 스페이스 탭, 따로 창은 리더), 못 그리는 형식·'다른 앱으로 열기'면 Rust 가 맥 기본 앱으로
import { opensInSpace } from '../../domain/teamLocker';
import { openChatFile } from '../chat/openChatFile';

/** open(external) = 풀기 명령(external 이면 Rust 가 기본 앱으로도 연다) — 푼 경로 */
export async function openTeamFile(open: (external: boolean) => Promise<string>, name: string, app = false): Promise<void> {
  const external = app || !opensInSpace(name);
  const path = await open(external);
  if (!external) await openChatFile(path, '');
}
