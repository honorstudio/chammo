// 팀 참모 만들기·고치기 — 시안 team-agent design-v2 섞음 1: 팀 설정 창이 두 칸으로 넓어져 왼쪽 정의, 오른쪽 시험 대화(방엔 안 올림)
// F1 스위치 줄 · F2 큰 얼굴 · F3 물어보는 시험 · F4 모델·고칠 사람·토큰 어림은 정의 칸 안 · F5 머리엔 저장 하나. 폰은 같은 칸을 세로로(시험은 아래 서랍)
import { useEffect, useRef, useState } from 'react';
import { teamAgentRefFiles, teamAgentRemove, teamAgentSave, teamAgentTry, type Tried } from '../../data/teamAgentApi';
import { GUIDE_MAX, NAME_MAX, BLURB_MAX, REFS_MAX, TEMPLATES, AGENT_COLORS, blankDef, estimate, modelLabel, nameProblem, tokensLabel, type AgentDef, type AgentList, type AgentRef, type AgentShown } from '../../domain/teamAgent';
import { tr } from '../../i18n';
import { IconArrowUp, IconBack, IconChevronDown, IconChevronUp, IconRefresh } from '../Icons';
import { IconButton } from '../kit/IconButton';
import { Confirm } from '../OrchDialogs';
import { AgentFace } from './TeamAgents';
import './teamAgent.css';

type Turn = { q: string; a?: Tried; err?: string };
/** 저장·지우기·시험·자료 목록 길 — 데스크톱은 Tauri 명령, 폰은 맥 폰 서버(data/web teamViaMac) */
export type AgentEditApi = { save: (team: string, def: AgentDef, origin?: string) => Promise<unknown>; remove: (team: string, id: string) => Promise<unknown>; tryRun: typeof teamAgentTry; refs: typeof teamAgentRefFiles };
const DESKTOP: AgentEditApi = { save: teamAgentSave, remove: teamAgentRemove, tryRun: teamAgentTry, refs: teamAgentRefFiles };

export function TeamAgentEdit({ team, list, editing, people, rooms, onBack, onSaved, api = DESKTOP }: {
  team: string;
  list: AgentList;
  /** 고칠 참모(null = 새로) */
  editing: AgentShown | null;
  /** 팀 사람 이름 — 참모 이름과 겹치면 안 된다 */
  people: string[];
  /** 시험으로 읽을 방(단톡방·DM) */
  rooms: { id: string; name: string }[];
  onBack: () => void;
  onSaved: () => void;
  api?: AgentEditApi;
}) {
  const [def, setDef] = useState<AgentDef>(editing?.def ?? { ...TEMPLATES[0]!.def });
  const [tpl, setTpl] = useState<string>(editing ? '' : TEMPLATES[0]!.key);
  const ro = !!editing && !editing.canEdit;
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [ask, setAsk] = useState<'remove' | null>(null);
  const [files, setFiles] = useState<AgentRef[] | null>(null);
  const [room, setRoom] = useState(rooms[0]?.id ?? '');
  const [log, setLog] = useState<Turn[]>([]);
  const [q, setQ] = useState('');
  const [trying, setTrying] = useState(false);
  // 폰·좁은 창에선 시험 칸이 아래 서랍(접힘 = 머리 줄만)
  const [open, setOpen] = useState(false);
  const logEnd = useRef<HTMLDivElement>(null);
  useEffect(() => { if (def.refs.length || files === null) void api.refs(team).then(setFiles, () => setFiles([])); }, [team]); // eslint-disable-line react-hooks/exhaustive-deps
  // 중괄호로 — 새 크롬은 scrollIntoView 가 Promise 를 돌려줘서 그대로 돌려주면 React 가 정리 함수로 부르다 죽는다(하네스 실측)
  useEffect(() => { logEnd.current?.scrollIntoView({ block: 'end' }); }, [log]);
  const set = (p: Partial<AgentDef>) => setDef((d) => ({ ...d, ...p }));
  const problem = nameProblem(def.name, people, list.agents, editing?.id ?? '');
  const refBytes = def.refs.length * 4000;
  const save = () => {
    if (problem || busy) return;
    setBusy(true);
    setErr('');
    void api.save(team, def, editing?.id).then(() => onSaved(), (e: unknown) => setErr(tr(`저장 못 했어요 — ${String(e)}`, `Couldn't save — ${String(e)}`))).finally(() => setBusy(false));
  };
  const remove = () => {
    if (!editing) return;
    setBusy(true);
    void api.remove(team, editing.id).then(() => onSaved(), (e: unknown) => setErr(tr(`못 지웠어요 — ${String(e)}`, `Couldn't delete — ${String(e)}`))).finally(() => { setBusy(false); setAsk(null); });
  };
  const run = (text: string) => {
    const t = text.trim() || tr('이 방 정리해 줘', 'Sum up this room');
    if (trying) return;
    const prev = log.filter((x) => x.a).map((x) => [x.q, x.a!.text] as [string, string]);
    setTrying(true);
    setLog((l) => [...l, { q: t }]);
    setQ('');
    void api.tryRun(team, room, def, t, prev)
      .then((a) => setLog((l) => l.map((x, i) => (i === l.length - 1 ? { ...x, a } : x))), (e: unknown) => setLog((l) => l.map((x, i) => (i === l.length - 1 ? { ...x, err: String(e) } : x))))
      .finally(() => setTrying(false));
  };
  const toggleRef = (r: AgentRef) => set({ refs: def.refs.some((x) => x.id === r.id) ? def.refs.filter((x) => x.id !== r.id) : [...def.refs, r].slice(0, REFS_MAX) });
  const title = def.name || tr('새 팀 참모', 'New team agent');

  return (
    <div className="tma-edit">
      <div className="tma-eh">
        <IconButton label={tr('뒤로', 'Back')} onClick={onBack}><IconBack /></IconButton>
        <b>{title}</b>
        {!ro && <button className="tmx-btn pri tmx-sm" disabled={!!problem || busy} onClick={save}>{busy ? tr('저장 중', 'Saving') : tr('저장', 'Save')}</button>}
      </div>
      <div className="tma-panes">
        <div className="tma-def">
          {!editing && (
            <div className="tma-chips" role="group" aria-label={tr('템플릿', 'Templates')}>
              {TEMPLATES.map((t) => <button key={t.key} className="tma-chip" aria-pressed={tpl === t.key} onClick={() => { setTpl(t.key); setDef({ ...t.def }); }}>{t.def.name}</button>)}
              <button className="tma-chip" aria-pressed={tpl === 'blank'} onClick={() => { setTpl('blank'); setDef(blankDef()); }}>{tr('빈 것', 'Blank')}</button>
            </div>
          )}
          <div className="tma-id">
            <button className="tma-facebtn" disabled={ro} onClick={() => set({ color: (def.color + 1) % AGENT_COLORS.length })} aria-label={tr('얼굴 색 바꾸기', 'Change face color')} title={tr('얼굴 색 바꾸기', 'Change face color')}>
              <AgentFace def={{ ...def, name: def.name || '?' }} size={48} />
            </button>
            <div className="tma-idf">
              <input value={def.name} maxLength={NAME_MAX} disabled={ro} onChange={(e) => set({ name: e.target.value })} placeholder={tr('이름(멘션)', 'Name (for @)')} aria-label={tr('이름', 'Name')} aria-invalid={!!problem && !!def.name} />
              <input value={def.blurb} maxLength={BLURB_MAX} disabled={ro} onChange={(e) => set({ blurb: e.target.value })} placeholder={tr('한 줄 설명', 'One-line description')} aria-label={tr('한 줄 설명', 'Description')} />
            </div>
          </div>
          {problem && def.name && <span className="tmx-hint" role="alert">{problem}</span>}
          <span className="tmx-fl">{tr('지침', 'Instructions')}</span>
          <textarea className="tma-guide" value={def.guide} maxLength={GUIDE_MAX} disabled={ro} onChange={(e) => set({ guide: e.target.value })} aria-label={tr('지침', 'Instructions')} />
          <span className="tmx-hint tma-count">{`${[...def.guide].length.toLocaleString()} / ${GUIDE_MAX.toLocaleString()}`}</span>
          <span className="tmx-fl">{tr('쓸 수 있는 것', 'Can use')}</span>
          <label className="tmp-sw tma-sw"><span><b>{tr('웹 검색', 'Web search')}</b><i>{tr('검색어만 밖으로 나가요', 'Only search words leave this computer')}</i></span>
            <input type="checkbox" role="switch" disabled={ro} checked={def.web} onChange={(e) => set({ web: e.target.checked })} /></label>
          <label className="tmp-sw tma-sw"><span><b>{tr('참고 자료', 'References')}</b><i>{def.refs.length ? def.refs.map((r) => r.name).join(' · ') : tr('팀 보관함 글 파일에서 고르기', 'Pick text files from the team locker')}</i></span>
            <input type="checkbox" role="switch" disabled={ro} checked={def.refs.length > 0} onChange={(e) => { if (!e.target.checked) set({ refs: [] }); else if (files?.[0]) set({ refs: [files[0]] }); }} /></label>
          {def.refs.length > 0 && !ro && files && (
            <div className="tma-chips" role="group" aria-label={tr('참고 자료 고르기', 'Pick references')}>
              {files.map((f) => <button key={f.id} className="tma-chip" aria-pressed={def.refs.some((r) => r.id === f.id)} onClick={() => toggleRef(f)}>{f.name}</button>)}
            </div>
          )}
          {files !== null && files.length === 0 && <span className="tmx-hint">{tr('팀 보관함에 글 파일(md·txt·csv)이 아직 없어요', 'No text files (md·txt·csv) in the team locker yet')}</span>}
          <label className="tmp-sw tma-sw"><span><b>{tr('답에 파일 붙이기', 'Attach files to answers')}</b><i>{tr('md·csv 한 개', 'One md or csv file')}</i></span>
            <input type="checkbox" role="switch" disabled={ro} checked={def.attach} onChange={(e) => set({ attach: e.target.checked })} /></label>
          <span className="tmx-hint tma-lock">{tr('명령 실행 · 파일 쓰기 · 내 컴퓨터 파일 · 발송은 늘 꺼짐', 'Running commands, writing files, files on your computer and sending are always off')}</span>
          <span className="tmx-fl">{tr('모델 · 고칠 수 있는 사람', 'Model · who can edit')}</span>
          <div className="tma-chips">
            {(['haiku', 'sonnet'] as const).map((m) => <button key={m} className="tma-chip" disabled={ro} aria-pressed={def.model === m} onClick={() => set({ model: m })}>{modelLabel(m)}</button>)}
            <button className="tma-chip" disabled={ro} aria-pressed={def.editors === 'both'} onClick={() => set({ editors: 'both' })}>{tr('만든 사람 + 팀장', 'Creator + owners')}</button>
            <button className="tma-chip" disabled={ro} aria-pressed={def.editors === 'owner'} onClick={() => set({ editors: 'owner' })}>{tr('팀장만', 'Owners only')}</button>
          </div>
          <span className="tmx-hint">{tr(`부를 때마다 대략 ${tokensLabel(estimate(def, refBytes))} 토큰 · 부른 사람 사용량`, `About ${tokensLabel(estimate(def, refBytes))} tokens per call · from the caller's usage`)}</span>
          {ro && <span className="tmx-hint">{tr('만든 사람·팀장만 고칠 수 있어요 — 시험은 돼요', 'Only the creator and owners can edit — you can still test')}</span>}
          {editing?.canEdit && <div className="tma-acts tma-left"><button className="tmx-btn danger tmx-sm" disabled={busy} onClick={() => setAsk('remove')}>{tr('팀 참모 지우기', 'Delete team agent')}</button></div>}
          {err && <span className="tmx-hint" role="alert">{err}</span>}
        </div>

        <div className={`tma-try ${open ? 'open' : ''}`}>
          <div className="tma-th">
            <b>{tr('시험', 'Test')}</b>
            {!open && log.at(-1)?.a && <span className="tmx-hint tma-drawer">{`${modelLabel(log.at(-1)!.a!.model)} · ${tokensLabel(log.at(-1)!.a!.tokens)}`}</span>}
            <select value={room} onChange={(e) => setRoom(e.target.value)} aria-label={tr('시험으로 읽을 방', 'Room to read')}>
              {rooms.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              {!rooms.length && <option value="">{tr('방 없음', 'No rooms')}</option>}
            </select>
            <IconButton label={tr('다시 불러 보기', 'Try again')} disabled={trying || !log.length} onClick={() => run(log[log.length - 1]?.q ?? '')}><IconRefresh /></IconButton>
            <IconButton className="tma-drawer" label={open ? tr('접기', 'Collapse') : tr('펼치기', 'Expand')} onClick={() => setOpen((x) => !x)}>{open ? <IconChevronDown /> : <IconChevronUp />}</IconButton>
          </div>
          <div className="tma-log">
            {!log.length && <span className="tmx-hint">{tr('방엔 안 올라가요 · 내 Claude 로 돌아요', "Not posted to the room · runs on your Claude")}</span>}
            {log.map((t, i) => (
              <div key={i} className="tma-turn">
                <div className="tma-q">{t.q}</div>
                {t.a ? (
                  <div className="tma-a">
                    <AgentFace def={{ ...def, name: def.name || '?' }} size={24} />
                    <div><div className="tma-at">{t.a.text}</div>
                      {t.a.files.map((f) => <span key={f} className="tmx-tag">{f}</span>)}
                      <span className="tmx-hint">{`${modelLabel(t.a.model)} · ${tokensLabel(t.a.tokens)} ${tr('토큰', 'tokens')} · ${(t.a.ms / 1000).toFixed(1)}${tr('초', 's')}`}</span></div>
                  </div>
                ) : t.err ? <span className="tmx-hint" role="alert">{tr(`시험 못 했어요 — ${t.err}`, `Test failed — ${t.err}`)}</span> : <span className="tmx-hint">{tr('만드는 중', 'Working')}</span>}
              </div>
            ))}
            <div ref={logEnd} />
          </div>
          <div className="tma-in">
            <textarea value={q} rows={1} onChange={(e) => setQ(e.target.value)} placeholder={tr('시험으로 물어보기', 'Ask as a test')} aria-label={tr('시험으로 물어보기', 'Ask as a test')}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); run(q); } }} />
            <IconButton tone="pri" label={tr('보내기', 'Send')} disabled={trying} onClick={() => run(q)}><IconArrowUp /></IconButton>
          </div>
        </div>
      </div>
      {ask === 'remove' && editing && (
        <Confirm title={tr(`${editing.def.name} 팀 참모를 지울까요?`, `Delete team agent ${editing.def.name}?`)} body={tr('팀 모두의 부르기 목록에서 빠져요. 지난 답은 대화에 남아요.', "It leaves everyone's mention list. Past answers stay in chats.")}
          ok={tr('정말 지우기', 'Delete')} danger onOk={remove} onCancel={() => setAsk(null)} />
      )}
    </div>
  );
}
