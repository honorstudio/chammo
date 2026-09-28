// 둘러보기 — 설정 마법사를 끝낸 첫 사용자에게 한 번 보여 주는 카드 몇 장(사용자 2026-09-28 아이맥 첫 사용:
// "단축키도 모르고 저런 기능들도 모르니까 온보딩이 있어야"). 다시 보기: ⌘/ · Chammo 메뉴 > 둘러보기
import { assistant, tr } from '../i18n';

export type TourStep = { title: string; body: string; keys?: [string, string][] };

export const shouldShowTour = (s: { setupDone: boolean; seen: boolean }) => s.setupDone && !s.seen;

/** 글자는 부를 때 만든다(언어·비서 이름이 설정 뒤에 정해져서) */
export const tourSteps = (): TourStep[] => {
  const a = assistant();
  return [
    {
      title: tr(`${a}한테 말로 시키세요`, `Tell ${a} what you want`),
      body: tr(
        `왼쪽 맨 위 ${a}(⌘1) 터미널에 "acme-shop 장바구니 합계 버그 고쳐줘"처럼 쓰면, ${a}가 그 프로젝트에 Claude Code 세션을 띄워 일을 나눠요. 돈이 걸린 일만 먼저 물어봐요. "이 앱 어떻게 써?"라고 물어도 돼요.`,
        `Type into ${a}'s terminal at the top left (⌘1) — "fix the cart total bug in acme-shop". ${a} starts a Claude Code session in that project and hands out the work. Only anything involving money is asked first. You can also ask "how do I use this app?"`,
      ),
    },
    {
      title: tr('진행은 오른쪽, 결정은 종', 'Progress on the right, decisions under the bell'),
      body: tr(
        `맡긴 일은 오른쪽 작업 패널(⌘J)에 쌓여요. ${a}가 정할 걸 물으면 오른쪽 위 종(결정 대기함)에 뜨고 알림이 와요. 알림이나 카드를 누르면 그 세션으로 바로 가서 바로 칠 수 있어요.`,
        `Delegated jobs stack up in the task panel on the right (⌘J). When ${a} needs a decision it lands under the bell at the top right, with a notification. Click it to jump straight into that session, ready to type.`,
      ),
    },
    {
      title: tr('모든 세션은 진짜 Claude Code', 'Every session is a real Claude Code'),
      body: tr(
        '⌘2 전체 보기에서 돌고 있는 세션을 한 화면에 봐요. 어느 창이든 직접 쳐서 끼어들어도 되고, ⌘Enter 로 크게 봤다가 되돌려요. PR 은 ⌘3 리뷰에서 관문(DB·돈·보안)과 함께 봐요.',
        'See every running session at once in All sessions (⌘2). Type into any of them to step in; ⌘Enter maximizes and restores a pane. PRs and their gates (DB, money, security) are under Review (⌘3).',
      ),
    },
    {
      title: tr('일하면 자라는 것들', 'Things that grow while you work'),
      body: tr(
        '⌘4 사무실 모드에서 세션들이 책상에서 일해요. 오른쪽 위 다마고치는 누르면 떠 있는 창으로 나오고, 커밋·머지·끝낸 일을 먹고 자라요. 일해서 모은 코인으로 사무실 왼쪽 위 뽑기·가구를 써요. 전부 설정에서 끌 수 있어요.',
        'Office mode (⌘4) shows your sessions at their desks. The Tamagotchi at the top right opens as a floating window and grows on commits, merges and finished jobs. Coins you earn go to the gacha and furniture at the top left of the office. All of it can be turned off in Settings.',
      ),
    },
    {
      title: tr('단축키', 'Shortcuts'),
      body: tr('설정은 오른쪽 위 톱니바퀴 버튼(⌘,). 이 안내는 ⌘/ 로 다시 볼 수 있어요.', 'Settings: the gear button at the top right (⌘,). Open this tour again with ⌘/.'),
      keys: [
        ['⌘1 · ⌘2 · ⌘3 · ⌘4', tr(`${a} · 전체 세션 · 리뷰 · 사무실`, `${a} · all sessions · review · office`)],
        ['⌘Enter', tr('보고 있는 창 크게 / 되돌리기', 'Maximize / restore the focused pane')],
        ['⌘T · ⌘W', tr('새 세션 · 보고 있는 세션 끄기', 'New session · stop the focused session')],
        ['⌘K · ⌘J · ⌘E', tr('검색 · 작업 패널 · 리더', 'Search · task panel · reader')],
        ['⌘M', tr('프로젝트 메모', 'Project notes')],
      ],
    },
  ];
};
