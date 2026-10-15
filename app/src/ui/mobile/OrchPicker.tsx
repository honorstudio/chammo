// 참모 바꾸기 — 입력창 오른쪽 아래 프사를 누르면 아래에서 올라오는 시트(한 손 엄지 기준). 맨 위 '답을 기다림', 그 아래 참모 줄.
// 줄 = 프사(둘레 고리 = 컨텍스트, 점 = 상태) + 이름 + 마지막 말 한 줄(시안 phone-dash O1, 2026-10-11 "글자가 너무 많다"). 맡은 일은 길게 눌러 메뉴.
// 시트 몸통(손잡이·목록 맨 위에서 끌어 닫기·바깥 누름)은 공용 BottomSheet. 지금 참모는 전체 테두리, 묻는 참모는 노란 면(왼쪽 띠 금지)
import { useEffect, useState } from 'react';
import type { MobileEnv } from '../../data/web';
import type { Ctx } from '../../domain/ctx';
import { answerFail, dupAnswer, lineSlot, phoneName, subStatus, waitAnswer, waitKey, type WaitSent, type Waiting } from '../../domain/mobile';
import type { Session } from '../../domain/session';
import { IconArrowUp, IconChevron, IconPin, IconPinOff, IconPlus, IconPower, IconTrash } from '../Icons';
import { orchVars } from '../../domain/orchTheme';
import { readOrder, readPins, readRoles, removeOrch, setPin, setRole, stopOrch, taskAnswer } from '../../data/web';
import { markWaitSent, peekWaitSent } from './waitSent';
import { renamePending, usePendingNicks } from './pendingNicks';
import { parseRoles, type RoleMap } from '../../domain/orchRoles';
import { splitOrchName } from '../../domain/orchLabel';
import { OrchMenu } from './OrchMenu';
import type { HomeRow } from '../../domain/orchHome';
import { parsePins } from '../../domain/orchPins';
import { orchSort } from '../../domain/orchOrder';
import { useMemoPoll } from './usePoll';
import { SwipeRow } from './SwipeRow';
import { josa, machine } from '../../i18n';
import { useOutbox } from './outbox';
import { MAvatar } from './MAvatar';
import { WaitNote } from './WaitNote';
import { askNote } from '../../domain/askNote';
import { NewOrchForm, OffOrchList, useOffOrchs, WakeNotice, type Wake } from './OrchWake';
import { HomeAppLink } from './HomeAppLink';
import { AvatarRing, BottomSheet, IconBtn } from './kit';
import { bodyColor, orchColor, useAvatars } from '../avatar';
import { orchDot } from '../../domain/orchDot';
import { useSubTails } from './useSubTails';

type Props = { title: string; env: MobileEnv; wake: Wake; onStopped: (id: string) => void; orchs: Session[]; current: string | undefined; ctx: Record<string, Ctx>; waiting: Waiting[]; sent: WaitSent; lines: Record<string, string>; onPick: (id: string) => void; onClose: () => void };

/** 답 기다림 카드에서 바로 답하기 — 그 참모 보낼 함으로(참모를 안 바꿔도 된다). 결정 대기함 물음은 무엇에 대한 답인지 붙고,
 *  맥 작업 기록에 answer 를 먼저 남긴 뒤 보낸다 — 카드는 누르자마자 숨고(기록이 실패하면 답을 채운 채 되돌림), 이미 답한 물음이면 안 보낸다.
 *  보낸 표시는 waitSent(앱 전체) — 시트를 다시 열어도 남는다. 물음 끝 '답: A / B' 줄은 빠른 답 알약 — 누르면 친 답과 같은 길로 */
function WaitReply({ w, name, sent }: { w: Waiting; name: string; sent: WaitSent }) {
  const out = useOutbox(w.orch, NO_ITEMS);
  const key = waitKey(w);
  const mine = sent[key];
  const [v, setV] = useState(mine?.fail ? mine.a : '');
  if (w.kind === 'blocked') return null;
  if (mine && !mine.fail) return <div className="m-muted m-sm">{name}에게 보냈어요</div>;
  const answers = askNote(w.q).answers;
  const send = (raw: string) => {
    const t = waitAnswer(w, raw);
    if (!t || dupAnswer(peekWaitSent(), key, raw, Date.now())) return;
    const a = raw.trim();
    markWaitSent(key, a);
    if (w.kind !== 'decide' || !w.taskId) { out.send(t); return; }
    withLimit(taskAnswer(w.taskId, a), ANSWER_LIMIT_MS).then(() => out.send(t), (e: Error) => {
      if (answerFail(e.message) === 'retry') markWaitSent(key, a, true);
    });
  };
  return (
    <>
      {mine?.fail && <div className="m-error">못 보냈어요 — 다시 눌러 주세요</div>}
      {answers.length > 0 && <div className="m-quick">{answers.map((a) => <button key={a} type="button" onClick={() => send(a)}>{a}</button>)}</div>}
      <form className="m-wait-reply" onSubmit={(e) => { e.preventDefault(); send(v); }}>
        <input value={v} onChange={(e) => setV(e.target.value)} placeholder="여기서 바로 답하기" enterKeyHint="send" aria-label={`${name}에게 답하기`} />
        <button type="submit" className="m-wait-go" disabled={!v.trim()} aria-label="보내기" title="보내기"><span className="m-cdot"><IconArrowUp /></span></button>
      </form>
    </>
  );
}
/** 결정 기록 기다리는 한도 — 홈 화면 앱은 백그라운드에서 요청이 매달린다(맥이 받았으면 다시 누를 때 서버가 again 으로 받아 준다) */
const ANSWER_LIMIT_MS = 15_000;
const withLimit = <T,>(p: Promise<T>, ms: number) => Promise.race([p, new Promise<T>((_, no) => setTimeout(() => no(new Error('timeout')), ms))]);
const NO_ITEMS: never[] = [];

const hm = (ts: string) => { const d = new Date(ts); return Number.isNaN(d.getTime()) ? '' : `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };

export function OrchPicker({ title, env, wake, onStopped, orchs, current, ctx, waiting, sent, lines, onPick, onClose }: Props) {
  const off = useOffOrchs(env, orchs);
  const { saved } = useAvatars(); // 고리 색 = 그 참모 색
  // 시트를 열 때 지난 켜기 결과는 지운다 — 시트를 닫아도 깨우기 상태는 앱에 남아서 옛 글이 다시 떴다
  const { clearNote } = wake;
  useEffect(() => { clearNote(); }, [clearNote]);
  // 맡은 일 — 맥 orch-roles.json(데스크톱과 같은 파일), 사람이 안 적었으면 최근 7일 기록으로 "주로 a·b". 이름 줄 오른쪽 회색(둘째 줄은 마지막 답 자리)
  const [rolesText] = useMemoPoll('roles', readRoles, 5000, '{}');
  const [rolesNow, setRolesNow] = useState<RoleMap | null>(null);
  const roles = rolesNow ?? parseRoles(rolesText);
  useEffect(() => { setRolesNow(null); }, [rolesText]);
  // 줄을 오른쪽→왼쪽으로 밀면 뒤 버튼(재우기·제거 / 깨우기·제거 — 아이콘, 제거는 글자 확인 카드), 왼쪽→오른쪽이면 고정 — 한 번에 한 줄만, 바깥 누름·스크롤에 닫힘(SwipeRow)
  const [openId, setOpenId] = useState<string | null>(null);
  // 고정 — 맥 orch-pins.json(데스크톱과 같은 파일), 누르면 바로 바꿔 보이고 맥 답으로 맞춘다
  const [pinsText] = useMemoPoll('pins', readPins, 5000, '[]');
  const [pinsNow, setPinsNow] = useState<string[] | null>(null);
  const pins = pinsNow ?? parsePins(pinsText);
  useEffect(() => { setPinsNow(null); }, [pinsText]);
  const togglePin = (sid: string, on: boolean) => {
    setPinsNow(on ? [...pins.filter((p) => p !== sid), sid] : pins.filter((p) => p !== sid));
    setPin(sid, on).then((v) => setPinsNow(v), () => setPinsNow(null));
  };
  // 순서 — 데스크톱 채팅 탭에서 끌어 둔 것(orch-order.json, 고정은 그 위). 사이드바·⌘1~9 와 같은 줄
  const [orderText] = useMemoPoll('order', readOrder, 5000, '[]');
  const sorted = orchSort(orchs, parsePins(orderText), pins, (s) => s.sessionId);
  // 상태 점은 세션판과 같은 판단(대화 꼬리) — 날 state 만 보면 감시를 띄운 참모가 '일함'이었다(bug-hunt L10). 시트가 열린 동안만 15초마다
  const tails = useSubTails(orchs);
  // 길게 누르기 메뉴(이름 바꾸기 + 밀기 동작 모두) — 켜진 참모·꺼진 참모
  const [menu, setMenu] = useState<{ kind: 'live'; s: Session } | { kind: 'off'; r: HomeRow } | null>(null);
  // 바꾼 이름 — 맥이 쉬는 때 /rename 을 보내 진짜 이름에 실릴 때까지 폰엔 바로 새 이름(대시보드 프로필 창과 같이 본다)
  const { nickOf, nameOf } = usePendingNicks(orchs);
  // 제거 — claude rm 은 목록에서만 빼고 대화 기록 파일은 맥에 남는다(실측). 다시 깨울 수는 없어서 빨강 확인
  const [removing, setRemoving] = useState<{ id: string; name: string; live: boolean; working: boolean } | null>(null);
  const [removeErr, setRemoveErr] = useState<string | null>(null);
  const [removeBusy, setRemoveBusy] = useState(false);
  const [removedOff, setRemovedOff] = useState<Set<string>>(new Set());
  const doRemove = async () => {
    if (!removing) return;
    setRemoveBusy(true);
    setRemoveErr(null);
    try {
      await removeOrch(removing.id);
      if (removing.live) onStopped(removing.id);
      else setRemovedOff((s) => new Set(s).add(removing.id));
      setRemoving(null);
    } catch (e) {
      const m = (e as Error).message;
      setRemoveErr(m === 'too soon' ? '방금 눌렀어요 — 10초 뒤에 다시' : `못 지웠어요: ${m}`);
    } finally {
      setRemoveBusy(false);
    }
  };
  // 재우기 — 확인(일하는 중이면 끊긴다고), 재우면 '꺼져 있음'으로(대화는 남아 다시 깨울 수 있다)
  const [sleeping, setSleeping] = useState<Session | null>(null);
  const [sleepErr, setSleepErr] = useState<string | null>(null);
  const [sleepBusy, setSleepBusy] = useState(false);
  const doSleep = async () => {
    if (!sleeping) return;
    setSleepBusy(true);
    setSleepErr(null);
    try {
      await stopOrch(sleeping.id);
      onStopped(sleeping.id);
      setSleeping(null);
    } catch (e) {
      const m = (e as Error).message;
      setSleepErr(m === 'too soon' ? '방금 눌렀어요 — 10초 뒤에 다시' : `못 재웠어요: ${m}`);
    } finally {
      setSleepBusy(false);
    }
  };
  const [naming, setNaming] = useState(false);
  const taken = [...orchs, ...off.map((r) => r.off!)].map((s) => phoneName(s.name, orchs));
  return (
    <>
      <BottomSheet label={`${title} 바꾸기`} title={`${title} 바꾸기`} onClose={onClose}
        actions={<IconBtn label={`새 ${title}`} onClick={() => setNaming(true)} disabled={naming}><IconPlus /></IconBtn>}>
      {removing && (
        <div className="m-sleep-card" role="alertdialog" aria-label="제거 확인">
          <div>{josa(removing.name, '을', '를')} 목록에서 제거할까요? 대화 기록 파일은 {machine()}에 남지만, 여기서 다시 깨울 수는 없어요.</div>
          {removing.working && <div className="m-sleep-warn">지금 일하는 중이라 하던 게 끊겨요.</div>}
          {removeErr && <div className="m-error">{removeErr}</div>}
          <div className="m-new-row">
            <button type="button" className="m-btn" onClick={() => setRemoving(null)}>취소</button>
            <button type="button" className="m-send m-danger" disabled={removeBusy} onClick={() => void doRemove()}>제거</button>
          </div>
        </div>
      )}
      {sleeping && (
        <div className="m-sleep-card" role="alertdialog" aria-label="재우기 확인">
          <div>{phoneName(sleeping.name, orchs)} 재울까요? 대화는 남고 나중에 '꺼져 있음'에서 다시 깨울 수 있어요.</div>
          {sleeping.state === 'working' && <div className="m-sleep-warn">지금 일하는 중이라 하던 게 끊겨요.</div>}
          {sleepErr && <div className="m-error">{sleepErr}</div>}
          <div className="m-new-row">
            <button type="button" className="m-btn" onClick={() => setSleeping(null)}>취소</button>
            <button type="button" className="m-send" disabled={sleepBusy} onClick={() => void doSleep()}>재우기</button>
          </div>
        </div>
      )}
      {naming && <NewOrchForm title={title} taken={taken} wake={wake} onDone={() => setNaming(false)} />}
      <WakeNotice wake={wake} />
      {wake.making && <div className="m-orch m-off" aria-busy="true"><span className="m-orch-text"><span className="m-orch-top"><span className="m-orch-name">{phoneName(wake.making, orchs)}</span><span className="m-muted m-sm">만드는 중…</span></span></span></div>}
      {waiting.length > 0 && (
        <>
          <div className="m-sect">답을 기다림 {waiting.length}</div>
          {waiting.map((w) => {
            const o = orchs.find((x) => x.id === w.orch);
            const n = phoneName(w.name, orchs);
            // 카드 면 = 그 참모 색을 옅게(mobile.css '나한테 묻는 것'). 그 참모로 가기 = 머리줄 전체 + 오른쪽 화살표 — '그 참모로 가서 보기' 글 버튼은 뺐다(2026-10-11 사용자)
            return (
              <div key={waitKey(w)} className="m-wait-card" style={orchVars(bodyColor(saved, w.name, orchColor(w.name))) as React.CSSProperties}>
                <button type="button" className="m-wait-top" onClick={() => onPick(w.orch)} aria-label={`${josa(n, '으로', '로')} 가기`} title={`${josa(n, '으로', '로')} 가기`}>
                  {o && <MAvatar orch={o} orchs={orchs} size={28} asking />}<b>{n}</b><span className="m-muted m-sm">{hm(w.ts)}</span><IconChevron />
                </button>
                {w.lead && <div className="m-muted m-sm">{w.lead}</div>}
                <WaitNote q={w.q} />
                <WaitReply w={w} name={n} sent={sent} />
              </div>
            );
          })}
          <div className="m-sect">{title}</div>
        </>
      )}
      {sorted.map((s) => {
        const pinned = !!s.sessionId && pins.includes(s.sessionId);
        const asking = waiting.some((w) => w.orch === s.id);
        const dot = orchDot(subStatus(s, tails, Date.now()), asking);
        const used = s.sessionId ? ctx[s.sessionId]?.used : undefined;
        const slot = lineSlot(lines[s.id]);
        return (
          <SwipeRow key={s.id} id={s.id} openId={openId} setOpenId={setOpenId} onMenu={() => setMenu({ kind: 'live', s })} menuLabel={`${nameOf(s)} 메뉴`} actions={[
            { label: '재우기', icon: <IconPower />, onPress: () => { setSleepErr(null); setSleeping(s); } },
            { label: '제거', icon: <IconTrash />, danger: true, onPress: () => { setRemoveErr(null); setRemoving({ id: s.id, name: nameOf(s), live: true, working: s.state === 'working' }); } },
          ]} start={s.sessionId ? [pinned
            ? { label: '고정 풀기', icon: <IconPinOff />, tone: 'pin', onPress: () => togglePin(s.sessionId!, false) }
            : { label: '고정', icon: <IconPin />, tone: 'pin', onPress: () => togglePin(s.sessionId!, true) }] : []}>
          <button type="button" className={`m-orch${s.id === current ? ' m-cur' : ''}${asking ? ' m-asking' : ''}`} onClick={() => onPick(s.id)}
            style={asking ? orchVars(bodyColor(saved, s.name, orchColor(s.name))) as React.CSSProperties : undefined}
            aria-label={`${nameOf(s)} — ${dot.label}${used !== undefined ? `, 컨텍스트 ${Math.round(used)}%` : ''}${pinned ? ', 고정' : ''}`}>
            <AvatarRing pct={used} dot={dot.cls} dotLabel={dot.label} color={bodyColor(saved, s.name, orchColor(s.name))}><MAvatar orch={s} orchs={orchs} size={34} asking={asking} /></AvatarRing>
            <span className="m-orch-text">
              <span className="m-orch-top">
                <span className="m-orch-name">{nameOf(s)}</span>
                {pinned && <span className="m-orch-pin" aria-hidden="true"><IconPin /></span>}
              </span>
              <span className="m-orch-sub"><span className={slot.skel ? 'm-orch-line m-skel-line' : 'm-orch-line'}>{slot.text}</span></span>
            </span>
          </button>
          </SwipeRow>
        );
      })}
      {orchs.length === 0 && <p className="m-muted">떠 있는 {title} 세션이 없어요</p>}
      <OffOrchList rows={off.filter((r) => !removedOff.has(r.off!.id))} orchs={orchs} wake={wake}
        swipe={{ openId, setOpenId, onMenu: (r) => setMenu({ kind: 'off', r }), onRemove: (r) => { setRemoveErr(null); setRemoving({ id: r.off!.id, name: phoneName(r.off!.name, orchs), live: false, working: false }); } }} />
      <HomeAppLink />
      </BottomSheet>
      {menu && (() => {
        const live = menu.kind === 'live';
        const sid = live ? menu.s.sessionId : menu.r.off!.sessionId;
        const title = live ? nameOf(menu.s) : phoneName(menu.r.off!.name, orchs);
        return (
          <OrchMenu title={title} live={live} pinned={!!sid && pins.includes(sid)} canPin={!!sid} nick={live ? (nickOf(menu.s) ?? splitOrchName(menu.s.name).nick ?? '') : ''}
            role={live ? roles[splitOrchName(menu.s.name).base]?.role ?? '' : ''}
            onRole={async (role) => { if (!live) return; setRolesNow(parseRoles(JSON.stringify(await setRole(menu.s.id, role)))); }}
            onClose={() => setMenu(null)}
            onRename={async (nick) => { if (live) await renamePending(menu.s.id, nick); }}
            onPick={(k) => {
              if (k === 'pin' || k === 'unpin') { if (sid) togglePin(sid, k === 'pin'); return; }
              if (k === 'sleep' && live) { setSleepErr(null); setSleeping(menu.s); return; }
              if (k === 'wake' && !live) { void wake.wake(menu.r); return; }
              if (k === 'remove') {
                setRemoveErr(null);
                setRemoving(live ? { id: menu.s.id, name: title, live: true, working: menu.s.state === 'working' } : { id: menu.r.off!.id, name: title, live: false, working: false });
              }
            }} />
        );
      })()}
    </>
  );
}
