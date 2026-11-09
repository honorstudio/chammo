// 공개 빌드의 자리표 — 이 칸들은 공식 설치 파일에만 있다. null 이면 화면이 그리지 않는다
import type { ProWeb } from '../domain/proSlot';

export const pro: ProWeb = { MemoryTab: null, AgentChat: null, tabLabel: () => '', mineRow: () => ({ title: '', sub: '' }) };
