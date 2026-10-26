// 둘러보기 — 설정 마법사를 끝낸 첫 사용자에게 한 번 보여 주는 카드 몇 장(사용자 2026-09-28 아이맥 첫 사용:
// "단축키도 모르고 저런 기능들도 모르니까 온보딩이 있어야"). 다시 보기: ⌘/ · Chammo 메뉴 > 둘러보기
import { assistant, tr } from '../i18n';
import { keyLabel } from './keys';
import { IS_WIN } from './reader';

export type TourStep = { title: string; body: string; keys?: [string, string][] };

export const shouldShowTour = (s: { setupDone: boolean; seen: boolean }) => s.setupDone && !s.seen;

/** 글자는 부를 때 만든다(언어·참모 이름이 설정 뒤에 정해져서).
 *  none = 참모가 아직 하나도 없다(마법사 바로 뒤 첫 화면) — 1장이 없는 채팅을 가리켰다(2026-10-22 첫 사용자 QA 9).
 *  예는 '새로 만들어 줘' 꼴 — 새 사용자 프로젝트 폴더는 비어 있어 있는 프로젝트를 예로 들면 "어디에도 없어"(QA 11) */
export const tourSteps = ({ none = false }: { none?: boolean } = {}): TourStep[] => {
  const a = assistant();
  return [
    {
      title: tr(`${a}한테 말로 시키세요`, `Tell ${a} what you want`),
      body: none
        ? tr(
          `첫 화면의 '새 ${a} 만들기'를 누르면 가운데에 ${a} 채팅이 열려요. 입력칸에 "할 일 목록 웹페이지 하나 만들어 줘"처럼 쓰면, ${a}가 프로젝트를 만들고 Claude Code 세션을 띄워 일을 나눠요. 돈이 걸린 일만 먼저 물어봐요. "이 앱 어떻게 써?"라고 물어도 돼요.`,
          `Press 'Create a new ${a}' on the first screen and ${a}'s chat opens in the middle. Type something like "make me a simple to-do list web page" — ${a} creates a project, starts a Claude Code session there and hands out the work. Only anything involving money is asked first. You can also ask "how do I use this app?"`,
        )
        : tr(
          `가운데 채팅의 ${a}(⌘1) 입력칸에 "할 일 목록 웹페이지 하나 만들어 줘"처럼 쓰면, ${a}가 프로젝트를 만들고 Claude Code 세션을 띄워 일을 나눠요. 돈이 걸린 일만 먼저 물어봐요. "이 앱 어떻게 써?"라고 물어도 돼요.`,
          `Type into ${a}'s chat in the middle (⌘1) — "make me a simple to-do list web page". ${a} creates a project, starts a Claude Code session there and hands out the work. Only anything involving money is asked first. You can also ask "how do I use this app?"`,
        ),
    },
    {
      // 채팅 뷰(기본)엔 작업 패널이 없다 — 터미널 뷰에서만(App tasksOpen && !spaceShown, QA 10)
      title: tr('진행은 대시보드, 결정은 종', 'Progress on the dashboard, decisions under the bell'),
      body: tr(
        `맡긴 일은 오른쪽 스페이스의 ${a} 대시보드에 세션별로 보여요(터미널 뷰에선 오른쪽 작업 패널 ⌘J). ${a}가 정할 걸 물으면 오른쪽 위 종(결정 대기함)에 뜨고 알림이 와요. 알림이나 카드를 누르면 그 세션으로 바로 가서 바로 칠 수 있어요.`,
        `Delegated work shows per session on ${a}'s dashboard in the space on the right (in the terminal view, the task panel on the right, ⌘J). When ${a} needs a decision it lands under the bell at the top right, with a notification. Click it to jump straight into that session, ready to type.`,
      ),
    },
    {
      title: tr('모든 세션은 진짜 Claude Code', 'Every session is a real Claude Code'),
      body: tr(
        '⌥⌘2 전체 보기에서 돌고 있는 세션을 한 화면에 봐요. 어느 창이든 직접 쳐서 끼어들어도 되고, ⌘⇧₩ 로 크게 봤다가 되돌려요. PR 은 ⌥⌘3 리뷰에서 관문(DB·돈·보안)과 함께 봐요.',
        'See every running session at once in All sessions (⌥⌘2). Type into any of them to step in; ⌘⇧` maximizes and restores a pane. PRs and their gates (DB, money, security) are under Review (⌥⌘3).',
      ),
    },
    {
      title: tr('일하면 자라는 것들', 'Things that grow while you work'),
      body: tr(
        '⌥⌘4 사무실 모드에서 세션들이 책상에서 일해요. 오른쪽 위 다마고치는 누르면 떠 있는 창으로 나오고, 커밋·머지·끝낸 일을 먹고 자라요. 일해서 모은 코인으로 사무실 왼쪽 위 뽑기·가구를 써요. 전부 설정에서 끌 수 있어요.',
        'Office mode (⌥⌘4) shows your sessions at their desks. The Tamagotchi at the top right opens as a floating window and grows on commits, merges and finished jobs. Coins you earn go to the gacha and furniture at the top left of the office. All of it can be turned off in Settings.',
      ),
    },
    {
      title: tr('단축키', 'Shortcuts'),
      body: tr('설정은 메뉴 Chammo > 설정…(⌘,). 층 모양 버튼(채팅 뷰는 왼쪽 아래, 터미널 뷰는 오른쪽 위)은 하니터 — 스킬·훅·MCP·플러그인을 보고 끄고 켜요. 이 안내는 ⌘/ 로 다시 볼 수 있어요.', 'Settings: Chammo > Settings… (⌘,). The layered button (bottom left in the chat view, top right in the terminal view) opens Harnitor — view and toggle skills, hooks, MCP and plugins. Open this tour again with ⌘/.'),
      keys: [
        [keyLabel('⌘1 ~ ⌘9', IS_WIN), tr('채팅 탭 이동 — 확대할 탭이 열려 있으면 ⌘9 는 맞춤', 'Switch chat tabs — with a zoomable tab open, ⌘9 fits it')],
        [keyLabel('⌥⌘1 · ⌥⌘2 · ⌥⌘3 · ⌥⌘4', IS_WIN), tr(`${a} · 전체 세션 · 리뷰 · 사무실`, `${a} · all sessions · review · office`)],
        [keyLabel(tr('⌘₩', '⌘`'), IS_WIN), tr('홈 대시보드 / 보던 화면', 'Home dashboard / back')],
        [keyLabel(tr('⌘⇧₩', '⌘⇧`'), IS_WIN), tr('보고 있는 창 크게 / 되돌리기', 'Maximize / restore the focused pane')],
        [keyLabel('⌘W · ⌘T', IS_WIN), tr('열린 탭 닫기 · 새 문서', 'Close tab · new document')],
        [keyLabel('⌘⇧H · ⌘⇧L', IS_WIN), tr('홈 · 보관함 탭으로', 'Go to Home · Locker tab')],
        [keyLabel('⌘⇧T · ⌘⇧W', IS_WIN), tr('새 세션 · 보고 있는 세션 끄기', 'New session · stop the focused session')],
        [keyLabel('⌘+ · ⌘- · ⌘0', IS_WIN), tr('열린 탭 확대 · 축소 · 100%', 'Tab zoom in · out · 100%')],
        [keyLabel('⌘K · ⌘J · ⌘E', IS_WIN), tr('검색 · 작업 패널 · 리더', 'Search · task panel · reader')],
        [keyLabel('⌘M', IS_WIN), tr('프로젝트 메모', 'Project notes')],
      ],
    },
  ];
};
