// 고른 곳을 짚은 채 참모에게 묻기(2026-11-13 사용자) — 스페이스 문서 선택 막대의 '물어보기', 그림 상자 고르기(BoxPick).
// 오른쪽 아래 '보낼 것'(SendFab)은 고친 걸 보내는 길이라 따로 — 이건 지금 보는 참모 입력칸에 칩만 붙이고 보내기는 사람이 한다
// 여기엔 BlockNote 를 들이지 않는다 — SpaceView 가 바로 부르는 파일이라 첫 화면 묶음에 편집기가 딸려 온다(startupBundle 시험). 막대 단추는 AskSelButton.tsx
import { createContext, useContext } from 'react';
import type { AskChip } from '../../domain/askPick';
import { tr } from '../../i18n';
import type { OrchTo } from './SendToOrch';

/** 받는 참모(지금 채팅 탭)와 나르기 — onLabel(i, 이름표) = 칩마다 받은 입력칸이 매긴 이름표(그림 상자 번호를 맞춘다) */
export type AskOrch = { to: OrchTo | null; ask: (chips: AskChip[], onLabel?: (i: number, label: string) => void) => void };
export const AskOrchContext = createContext<AskOrch | null>(null);
export const useAskOrch = () => useContext(AskOrchContext);

/** 이름은 짧게 하나 — 받는 참모는 단추 색이 말한다(둘째 줄 설명 없이, 11-13 사용자 "텍스트 많은 거 싫어") */
export const askLabel = (_to?: OrchTo | null) => tr('물어보기', 'Ask');
