// 팀 참모(ADR 0017) — 얼굴(둥근 네모, 사람 동그라미와 갈림)·팀 설정 '팀 참모' 칸·부르기 전 확인 장(시안 team-agent design-v1 X1)
import { useEffect, useState } from 'react';
import { teamAgents } from '../../data/teamAgentApi';
import { changesOf, modelLabel, needsConfirm, toolLabel, type AgentList, type AgentShown, type Confirmed } from '../../domain/teamAgent';
import { tr } from '../../i18n';
import { IconPlus } from '../Icons';
import { IconButton } from '../kit/IconButton';
import { AgentFace, HelperFace } from './RoomBits';
import './teamAgent.css';

export { AgentFace };

/** 팀 설정 안 '팀 참모' 칸 — 목록·추가. 누르면 onEdit(고칠 참모, 새로 만들기면 null) */
export function AgentsSection({ team, onEdit, load = teamAgents }: { team: string; onEdit: (a: AgentShown | null, list: AgentList) => void; load?: (team: string) => Promise<AgentList> }) {
  const [list, setList] = useState<AgentList | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => { void load(team).then((l) => { setList(l); setErr(''); }, (e: unknown) => setErr(String(e))); }, [team, load]);
  return (
    <>
      <div className="tmp-sec">
        <span className="tmx-fl">{tr('팀 참모', 'Team agents')}</span>
        {list && <IconButton size="s" label={tr('팀 참모 추가', 'Add a team agent')} onClick={() => onEdit(null, list)}><IconPlus /></IconButton>}
      </div>
      <ul className="tma-list">
        <li className="tma-row tma-base"><HelperFace size={28} /><span className="tma-who"><b>{tr('팀참모', 'TeamHelper')}<span className="tmx-tag">{tr('기본', 'built-in')}</span></b><span>{tr('방 글을 읽고 요약·정리', 'Reads the room, summarizes')}</span></span></li>
        {list?.agents.map((a) => {
          const changed = !!list.seen[a.id] && needsConfirm(a, list.seen);
          return (
            <li key={a.id}>
              <button className="tma-row" onClick={() => onEdit(a, list)} aria-label={tr(`${a.def.name} 팀 참모 열기`, `Open team agent ${a.def.name}`)}>
                <AgentFace def={a.def} />
                <span className="tma-who">
                  <b>{a.def.name}{changed && <i className="tma-dot" title={tr('지침이 바뀜', 'Instructions changed')} />}{a.clash && <span className="tmx-tag">{tr('이름 겹침', 'name clash')}</span>}</b>
                  <span>{[a.def.blurb, modelLabel(a.def.model)].filter(Boolean).join(' · ')}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <span className="tmx-hint">{err ? tr(`팀 참모 목록을 못 받았어요 — ${err}`, `Couldn't load team agents — ${err}`) : tr('부를 땐 부른 사람 Claude 로 돌아요', "Runs on the caller's own Claude")}</span>
    </>
  );
}

/** 처음·바뀐 뒤 부를 때 보내기 직전 한 장(P2) — 도구가 늘었으면 노란 줄. ok = 확인하고 부르기, plain = 부르지 않고 보내기 */
export function AgentConfirm({ agent, seen, caller, onOk, onPlain, onCancel }: { agent: AgentShown; seen?: Confirmed; caller: string; onOk: () => void; onPlain: () => void; onCancel: () => void }) {
  const c = changesOf(seen?.def, agent.def);
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onCancel(); } };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  }, [onCancel]);
  return (
    <div className="tma-confirm" role="alertdialog" aria-modal="true" aria-label={tr(`${agent.def.name} 지침 확인`, `Check ${agent.def.name}'s instructions`)}>
      <div className="tma-ch">
        <AgentFace def={agent.def} size={36} />
        <div><b>{c.first ? tr(`${agent.def.name} 처음 불러요`, `First call to ${agent.def.name}`) : tr(`${agent.def.name} 지침이 바뀌었어요`, `${agent.def.name}'s instructions changed`)}</b>
          <span>{agent.def.blurb}</span></div>
      </div>
      {c.toolsOn.length > 0 && <div className="tma-warn">{tr(`켜진 것: ${c.toolsOn.map(toolLabel).join(' · ')}`, `Turned on: ${c.toolsOn.map(toolLabel).join(' · ')}`)}{c.toolsOn.includes('web') && tr(' — 검색어가 밖으로 나가요', ' — search words leave this computer')}</div>}
      {c.toolsOff.length > 0 && <div className="tmx-hint">{tr(`꺼진 것: ${c.toolsOff.map(toolLabel).join(' · ')}`, `Turned off: ${c.toolsOff.map(toolLabel).join(' · ')}`)}</div>}
      {c.model && <div className="tmx-hint">{tr(`모델 ${modelLabel(c.model[0])} → ${modelLabel(c.model[1])}`, `Model ${modelLabel(c.model[0])} → ${modelLabel(c.model[1])}`)}</div>}
      {c.first
        ? <pre className="tma-diff">{agent.def.guide}</pre>
        : (c.added.length > 0 || c.removed.length > 0) && <pre className="tma-diff" aria-label={tr('뺀 줄은 지운 줄, 더한 줄은 초록', 'Removed lines struck through, added lines in green')}>{c.removed.map((l, i) => <del key={`d${i}`}>{l}{'\n'}</del>)}{c.added.map((l, i) => <ins key={`a${i}`}>{l}{'\n'}</ins>)}</pre>}
      <span className="tmx-hint">{tr(`${caller} 님 Claude 로 돌아요 · ${modelLabel(agent.def.model)}`, `Runs on ${caller}'s Claude · ${modelLabel(agent.def.model)}`)}</span>
      <div className="tma-acts">
        <button className="tmx-btn tmx-sm" onClick={onPlain}>{tr('부르지 않고 보내기', 'Send without calling')}</button>
        <button className="tmx-btn pri tmx-sm" autoFocus onClick={onOk}>{tr('확인하고 부르기', 'Check and call')}</button>
      </div>
    </div>
  );
}
