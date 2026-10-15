// 세션 상태 표시 — 일함 = 도는 호, 물음 = 노란 점, 그 밖은 없음(옛 왼쪽 메뉴 SpaceNav 에서 옮김, 패널 하나로 7)
import { statusTone, statusWord, type ActivityStatus } from '../../domain/status';

export function StateMark({ st }: { st: ActivityStatus }) {
  const c = statusTone(st);
  return c === 'run' ? <span className="cv-spin" title={statusWord(st)} /> : c === 'ask' ? <span className="cv-ask" title={statusWord(st)} /> : null;
}
