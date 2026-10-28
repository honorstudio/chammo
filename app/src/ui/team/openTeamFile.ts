// 팀 파일 열기(보관함 줄·대화 파일 풍선 공용, 10-26 사용자) — Rust 가 데이터 폴더 자리(team-locker-peek)에 풀고,
// 편집 앱이 맞는 형식(.ai·.psd·.dwg … domain/craftOpen craftFirst)이면 참모 앱으로(안 깔렸으면 한 번 묻고 설치),
// 스페이스가 그리는 형식이면 scripts/show 와 같은 길(openChatFile — 채팅 뷰는 스페이스 탭, 따로 창은 리더), 못 그리는 형식·'다른 앱으로 열기'면 Rust 가 맥 기본 앱으로
import { craftFirst, craftFor } from '../../domain/craftOpen';
import { markTeamCraft } from '../../domain/teamCraft';
import { opensInSpace } from '../../domain/teamLocker';
import { openChatFile } from '../chat/openChatFile';
import { openInCraft } from '../craft/openInCraft';

/** how: false = 알아서(기본), true = 맥 기본 앱, 'preview' = 스페이스 미리보기, 'craft' = 참모 앱 */
export type TeamOpenHow = boolean | 'preview' | 'craft';

/** open(external) = 풀기 명령(external 이면 Rust 가 기본 앱으로도 연다) — 푼 경로 */
export async function openTeamFile(open: (external: boolean) => Promise<string>, name: string, how: TeamOpenHow = false): Promise<void> {
  const craft = how === 'craft' || (how === false && craftFirst(name));
  const external = how === true || (how === false && !craft && !opensInSpace(name));
  const path = await open(external);
  if (craft) { markTeamCraft(craftFor(name) ?? '', path); await openInCraft(path); } // 표시 = 칸을 팀 화면에(domain/teamCraft)
  else if (!external) await openChatFile(path, '', undefined, true);
}
