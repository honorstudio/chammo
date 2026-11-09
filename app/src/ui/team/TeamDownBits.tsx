/** 팀 파일 받기 — 받기 아이콘(늘 보임)·받는 중 막대와 멈추기·다 받으면 폴더에서 보기·열기·실패면 다시 받기(11-01 사용자 시안 승인).
 *  대화 파일 말풍선과 팀 보관함 줄·카드가 같이 쓴다. 상태는 Rust team_down 기록(받는 동안 0.5초마다 읽는다) */
import { invoke } from '@tauri-apps/api/core';
import { useCallback, useEffect, useState } from 'react';
import { withRunAsk } from '../../domain/teamLocker';
import { downOf, downRatio, downStatus, type TeamDown } from '../../domain/teamDown';
import { tr } from '../../i18n';
import { IconDownload, IconOpen, IconRefresh, IconReveal, IconStop } from '../Icons';
import { IconButton } from '../kit/IconButton';
import { confirmRunnable } from './confirmRunnable';

// 받기 줄은 앱에 하나 — 대화 말풍선에서 시작한 받기가 옆 팀 보관함 줄에도 같이 보이게, 읽기도 한 줄기(받는 중·막 누른 받기가 있을 때만 0.5초마다)
let shared: TeamDown[] = [];
const subs = new Set<(l: TeamDown[]) => void>();
let watchers = 0;
let timer: ReturnType<typeof setInterval> | null = null;
function pollNow(): Promise<void> {
  return invoke<TeamDown[]>('team_down_list', { team: '' }).then((l) => { shared = l; subs.forEach((f) => f(l)); pace(); }, () => {});
}
function pace() {
  const need = watchers > 0 || shared.some((d) => d.state === 'going');
  if (need && !timer) timer = setInterval(() => void pollNow(), 500);
  if (!need && timer) { clearInterval(timer); timer = null; }
}

/** 받기 줄을 읽는다. on = false(폰)면 안 읽는다 */
export function useTeamDowns(on = true) {
  const [list, setList] = useState<TeamDown[]>(shared);
  useEffect(() => {
    if (!on) return;
    subs.add(setList);
    void pollNow();
    return () => { subs.delete(setList); };
  }, [on]);
  /** 받기 명령을 돌리는 동안 지켜본다 — 실패는 받기 줄(이유 한 줄)이 보여 주니 여기선 삼킨다 */
  const watch = useCallback(<T,>(p: Promise<T>) => {
    watchers++;
    pace();
    void pollNow();
    return p.then(() => {}, () => {}).finally(() => { watchers--; void pollNow(); });
  }, []);
  const stop = useCallback((d: TeamDown) => void invoke('team_down_stop', { team: d.team, id: d.id }).then(pollNow, () => {}), []);
  /** 다 받은 파일 열기·폴더에서 보기 — 그새 지워졌으면 그 줄을 치워 받기 아이콘으로 돌아간다(누르면 다시 받는다) */
  const show = useCallback((d: TeamDown, how: 'open' | 'reveal') => withRunAsk((runOk) => invoke('team_down_show', { team: d.team, id: d.id, how, runOk }), confirmRunnable).catch((e: unknown) => {
    void invoke('team_down_dismiss', { team: d.team, id: d.id }).then(pollNow, () => {});
    throw e;
  }), []);
  return { list, of: (id: string) => downOf(list, id), watch, stop, show };
}

export type DownApi = ReturnType<typeof useTeamDowns>;

/** 이름 아래 한 줄 — 받는 중 '받은 / 전체', 다 받음 '크기 · 받았어요', 실패는 이유(상태 색 tmx-dl-err). 받기 줄이 없으면 normal */
export function DownLine({ d, normal, bin = false }: { d?: TeamDown; normal: React.ReactNode; /** 팀 보관함 칸 — 1024 단위 */ bin?: boolean }) {
  if (!d) return <>{normal}</>;
  const s = downStatus(d, bin);
  return <span className={s.err ? 'tmx-dl-err' : 'tmx-dl-num'} title={d.state === 'failed' && d.why === 'other' ? d.error : undefined}>{s.text}</span>;
}

/** 받는 중 막대 — 받은 MB / 전체 */
export function DownBar({ d, className = '' }: { d?: TeamDown; className?: string }) {
  if (d?.state !== 'going') return null;
  return <span className={`tmx-dl-bar ${className}`} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(downRatio(d) * 100)}><i style={{ width: `${downRatio(d) * 100}%` }} /></span>;
}

/** 오른쪽 아이콘 — 받기 전 받기 · 받는 중 멈추기 · 다 받음 폴더에서 보기·열기 · 실패 다시 받기. 여는 길(open)이 받는 중이어도 멈추기 */
export function DownActs({ d, onSave, onRetry = onSave, api, onFail, className = '' }: { d?: TeamDown; onSave: () => void; /** 실패 뒤 — 여는 길이 실패했으면 다시 열기 */ onRetry?: () => void; api: DownApi; onFail?: (e: unknown) => void; className?: string }) {
  const fail = onFail ?? (() => {});
  return (
    <span className={`tmx-dl ${className}`} onClick={(e) => e.stopPropagation()} onContextMenu={(e) => e.stopPropagation()}>
      {!d && <IconButton label={tr('받기', 'Download')} onClick={onSave}><IconDownload /></IconButton>}
      {d?.state === 'going' && <IconButton label={tr('받기 멈추기', 'Stop download')} onClick={() => api.stop(d)}><IconStop /></IconButton>}
      {d?.state === 'done' && <>
        <IconButton label={tr('폴더에서 보기', 'Show in folder')} onClick={() => void api.show(d, 'reveal').catch(fail)}><IconReveal /></IconButton>
        <IconButton label={tr('열기', 'Open')} onClick={() => void api.show(d, 'open').catch(fail)}><IconOpen /></IconButton>
      </>}
      {d?.state === 'failed' && <IconButton label={tr('다시 받기', 'Retry download')} onClick={onRetry}><IconRefresh /></IconButton>}
    </span>
  );
}
