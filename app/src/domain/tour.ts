// 둘러보기 — 설정 마법사를 끝낸 첫 사용자에게 한 번 보여 주는 카드 몇 장(사용자 2026-09-28 아이맥 첫 사용:
// "단축키도 모르고 저런 기능들도 모르니까 온보딩이 있어야"). 다시 보기: ⌘/ · Chammo 메뉴 > 둘러보기
import { assistant, josa, tr } from '../i18n';
import type { Gate } from './loginGate';
import { keyLabel } from './keys';
import { IS_WIN } from './reader';

export type TourStep = { title: string; body: string; keys?: [string, string][] };

export const shouldShowTour = (s: { setupDone: boolean; seen: boolean }) => s.setupDone && !s.seen;

/** 그릴까 — 로그인 문(LoginGate)이 닫힌 뒤에만. 문 위에 떠 그 밑 첫 화면을 설명했고, 닫으면 본 걸로 쳐서 로그인 뒤엔 안 떴다(2026-11-01 ux-start H1).
 *  gate = 로그인 문 상태(null = 아직 못 읽음 — 깜빡 떴다 덮이지 않게 기다린다) */
export const tourVisible = (open: boolean, gate: Gate | null): boolean => open && gate === 'none';

/** 글자는 부를 때 만든다(언어·참모 이름이 설정 뒤에 정해져서).
 *  none = 참모가 아직 하나도 없다(마법사 바로 뒤 첫 화면) — 1장이 없는 채팅을 가리켰다(2026-10-22 첫 사용자 QA 9).
 *  예는 '새로 만들어 줘' 꼴 — 새 사용자 프로젝트 폴더는 비어 있어 있는 프로젝트를 예로 들면 "어디에도 없어"(QA 11) */
export const tourSteps = ({ none = false }: { none?: boolean } = {}): TourStep[] => {
  // 2026-11-01 ux-start M5(시안 v1 사용자 '추천대로') — 맡기기 → 진행 → 결과 → 결정 → 키 셋. 사무실·다마고치·전체 보기·키 표는 뺐다(문구 소넷, 제목은 말 거는 투 없이 — 사용자 같은 날)
  const a = assistant();
  const ga = josa(a, '이', '가');
  return [
    {
      title: tr(`${a}에게 일 맡기기`, `Handing work to ${a}`),
      body: none
        ? tr(
          `첫 화면에서 '새 ${a} 만들기'를 누르면 가운데에 채팅이 열려요. 입력칸에 할 일을 쓰면 ${ga} 프로젝트를 만들고 세션을 띄워 일을 맡겨요. 돈이 걸린 일은 먼저 물어봐요.`,
          `On the first screen, click 'Create a new ${a}' and a chat opens in the middle. Type what you need in the box, and ${a} creates a project, starts a session, and hands off the work. It asks first before anything that involves money.`,
        )
        : tr(
          `가운데 ${a} 채팅 입력칸에 할 일을 쓰면 ${ga} 프로젝트를 만들고 세션을 띄워 일을 맡겨요. 돈이 걸린 일은 먼저 물어봐요.`,
          `Type what you need in the ${a} chat box in the middle, and ${a} creates a project, starts a session, and hands off the work. It asks first before anything that involves money.`,
        ),
    },
    {
      title: tr('진행', 'Progress'),
      body: tr(
        '맡긴 일은 오른쪽 스페이스 맨 위 진행 칸에 프로젝트별로 보여요. 누르면 그 일을 하는 세션을 볼 수 있어요.',
        "Work you've handed off appears by project in the Progress section at the top of the right-hand space. Click one to see the session doing that work.",
      ),
    },
    {
      title: tr('결과물과 보관함', 'Results and locker'),
      body: tr(
        '문서, 웹페이지, 그림 같은 결과물은 채팅에 파일 카드로 와요. 누르면 오른쪽 스페이스에 탭으로 열리고, 남겨 둔 파일은 보관함에 있어요.',
        'Documents, web pages, images, and other results arrive in the chat as file cards. Click one to open it as a tab in the right-hand space. Files you keep are in your locker.',
      ),
    },
    {
      title: tr('결정 대기', 'Decisions'),
      body: tr(
        `${ga} 사람이 정할 걸 물으면 오른쪽 위 종에 뜨고 알림이 와요. 거기서 바로 답하면 돼요.`,
        `When ${a} needs a decision from you, it shows up at the bell in the top right and sends a notification. You can answer right there.`,
      ),
    },
    {
      title: tr('단축키', 'Shortcuts'),
      body: tr(
        `설정은 ⌘, 이 안내 다시 보기는 ⌘/ ${a} 채팅 탭 이동은 ⌘1~⌘9 예요. 사무실이나 뽑기 같은 놀이 기능은 설정에서 켜고 끌 수 있어요.`,
        `Settings is ⌘, and this tour is ⌘/. Switch between ${a} chat tabs with ⌘1 to ⌘9. Fun features like the office and the gacha can be turned on or off in Settings.`,
      ),
    },
  ];
};
