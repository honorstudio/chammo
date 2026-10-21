import { tr } from '../i18n';

/**
 * 새 참모 첫 지시 = 자기소개(2026-10-21 사용자 — '준비됐어' 한 줄은 어색). 질문으로 끝나면 결정 대기 창이 채팅을 덮었다(2026-09-30 시험).
 * 앞의 [앱] = 앱이 넘긴 줄 — 사람이 친 말풍선처럼 보였다(2026-10-22 첫 사용자 QA 25). 'chief of staff' 같은 영어 직함이 섞여 우리말로.
 * 폰에서 깨울 때(src-tauri mobile.rs spawn)도 같은 글 — orchIntro.test 가 대조한다
 */
export const orchIntro = (): string =>
  tr(
    '[앱] 안녕! 네 이름과 맡은 일로 2~3줄 자기소개해 줘 — 누구고, 뭘 맡았고, 이런 걸 시키면 된다는 예 하나. 영어 직함 없이 우리말로, 도구는 쓰지 말고, 질문으로 끝내지 마.',
    "[앱] Hi! Introduce yourself in 2-3 lines from your name and role — who you are, what you handle, and one example of what to ask you. Don't use tools, and don't end with a question.",
  );
