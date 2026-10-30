// 팀 홈 참모 모드 칸(ADR 0018 7) — 보는 사람 기기에서 각자, 이 기기에 깔린 가벼운(light) 모드만, 처음 볼 때 '켜기' 한 번(이 기기에 기억).
// 꺼져 있으면 대시보드 자리 team:<팀 id> 로 켠다 — 이미 다른 자리에 켜져 있으면 옮기지 않고 그 호스트를 그대로 그린다(모드 하나 = 자리 하나)
import { invoke } from '@tauri-apps/api/core';
import { useEffect, useRef, useState } from 'react';
import { lightModes, modeBlockState, modeOkKey } from '../../domain/teamHome';
import { tr } from '../../i18n';
import { useModeRows } from '../mode/ModePanel';
import { ModeView } from '../mode/ModeView';
import { TeamHome } from './TeamHome';

const OK_KEY = 'chammo.teamHomeModeOk';
const readOk = (): string[] => { try { return JSON.parse(localStorage.getItem(OK_KEY) ?? '[]') as string[]; } catch { return []; } };
const keepOk = (k: string) => { try { localStorage.setItem(OK_KEY, JSON.stringify([...new Set([...readOk(), k])].slice(-200))); } catch { /* 이번 실행만 */ } };

export function HomeModeBlock({ teamId, block, mode, editing }: { teamId: string; block: string; mode: string; editing: boolean }) {
  const rows = useModeRows();
  const key = modeOkKey(teamId, block, mode);
  // 꽂은 모드가 바뀌면 열쇠도 바뀐다 — 기억 목록에서 그때그때 본다
  const [oks, setOks] = useState(readOk);
  const ok = oks.includes(key);
  const [err, setErr] = useState('');
  const asked = useRef('');
  const row = rows.find((r) => r.name === mode);
  const st = modeBlockState(mode, row, ok);
  // 켜기를 한 번 누른 칸 — 꺼져 있으면(앱을 다시 켰다 등) 이 칸을 볼 때 다시 켠다. 같은 모드는 한 번만 묻는다
  useEffect(() => {
    if (st !== 'start' || asked.current === mode) return;
    asked.current = mode;
    void invoke('mode_open', { name: mode, place: 'dash', dash: `team:${teamId}` }).catch((e: unknown) => setErr(String(e)));
  }, [st, mode, teamId]);

  const title = row?.title || mode;
  return (
    <>
      <div className="hb-bh">{mode ? title : tr('참모 모드', 'Chammo mode')}<span className="hb-mtag">{tr('모드', 'Mode')}</span><span className="hb-sp" /></div>
      {editing ? <div className="hb-none">{mode ? tr('꾸미기를 마치면 여기에 그려져요', 'Shown here after you finish') : tr('오른쪽 위에서 꽂을 모드를 골라요', 'Pick a mode at the top right')}</div>
        : st === 'empty' ? <div className="hb-none">{tr('아직 꽂은 모드가 없어요. 참모에게 "이런 화면 만들어 줘"라고 하거나, 메뉴 모드 > 새 모드 만들기…를 눌러 보세요', 'No mode placed yet. Ask your assistant to build the screen you want, or choose Modes > New Mode… in the menu')}</div>
        : st === 'missing' ? <div className="hb-none">{tr(`이 기기엔 없는 모드예요 — ${mode}`, `This mode isn't on this device — ${mode}`)}</div>
        : st === 'heavy' ? <div className="hb-none">{tr('가벼운 모드만 팀 홈에 보여요', 'Only light modes show on the team home')}</div>
        : st === 'ask' ? (
          <div className="hb-edit">
            <div className="hb-none">{tr('이 기기에서 이 모드를 켜서 보여 줘요. 내 기기에서만 돌고 팀엔 안 보내요.', 'Runs this mode on this device to show it. It stays on your device.')}</div>
            {/* 프로세스를 띄우는 낯선 동작이라 글자 단추 */}
            <div><button className="tmx-btn" onClick={() => { keepOk(key); setOks(readOk().concat(key)); }}>{tr('켜기', 'Turn on')}</button></div>
          </div>
        )
        : st === 'start' ? <div className="hb-none">{err || tr('켜는 중…', 'Starting…')}</div>
        : <div className="hb-mode-view"><ModeView name={mode} compact /></div>}
    </>
  );
}

/** 데스크톱 팀 홈 — 이 기기 가벼운 모드를 모드 칸 고르기·그리기로 넘긴다(폰 묶음엔 모드 화면을 안 싣는다) */
export function TeamHomeDesktop(p: React.ComponentProps<typeof TeamHome>) {
  const rows = useModeRows();
  return <TeamHome {...p} modeChoices={lightModes(rows).map((r) => ({ name: r.name, title: r.title }))}
    modeBlock={(b, editing) => <HomeModeBlock teamId={p.teamId} block={b.id} mode={b.mode ?? ''} editing={editing} />} />;
}
