// 떠 있는 참모 배지(시안 .shots/orch-bubble v1 A — 10-28 사용자 "A 좋다"). 배지는 앱 안에 없고 늘 바탕 배지 창 하나(DeskBubble, 10-28 사용자 "하나만").
// 여기 남은 건 앱 안 대화창 — 참모 채팅 칸이 가려진 화면에서 놓은 파일·준 파일을 그 칸째 띄운다.
// 대화창은 새로 짠 채팅이 아니라 참모 채팅 칸(SessionGrid + ChatView) 그 자체를 떠 있는 창으로 옮긴 것(FloatHost):
// 터미널 붙임·입력 중인 글이 그대로라 새 attach 가 없다(바쁜 맥에서 attach 를 늘리면 일하는 세션이 재시작된다 — 교훈).
import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { BADGE, ORCH_DROPPED, placeOf, popPlace, readAnchor, type Rect } from '../../domain/orchBubble';
import { orchVars } from '../../domain/orchTheme';
import { tr } from '../../i18n';
import { IconDockIn, IconMaximize, IconMinimize, IconRestore } from '../Icons';
import { IconButton } from '../kit/IconButton';
import './orchBubble.css';

/** 배지·대화창 머리에 그릴 참모 — 띠 프사(RailAvatar)에서 쓰는 것만 */
export type BubbleOrch = { id: string; label: string; color: string; pip?: 'ask' | 'new' | 'run' | 'rest' | null; node: React.ReactNode; small: React.ReactNode };

/** 대화창이 열려 있으면 그 자리·머리 — 참모 채팅 칸을 감싼 FloatHost 가 받아 칸째 떠 있는 창이 된다 */
export type BubbleFloat = { rect: Rect; head: React.ReactNode; label: string } | null;
export const BubbleFloatCtx = createContext<BubbleFloat>(null);

/** 참모 채팅 칸 감싸기 — 평소엔 display: contents(칸 모양 그대로), 대화창이 열리면 같은 요소가 떠 있는 창이 된다(다시 붙지 않게 모양만 바꾼다).
 *  children(floating) — 떠 있는 동안 격자는 탭 보기(참모 하나씩)로 */
export function FloatHost({ children }: { children: (floating: boolean) => React.ReactNode }) {
  const f = useContext(BubbleFloatCtx);
  return (
    <div className={`obb-host${f ? ' obb-float' : ''}`} role={f ? 'dialog' : undefined} aria-label={f?.label}
      style={f ? { left: f.rect.x, top: f.rect.y, width: f.rect.w, height: f.rect.h } : undefined}>
      <div className="obb-head">{f?.head}</div>
      <div className="obb-body">{children(!!f)}</div>
    </div>
  );
}

const POP = { w: 360, h: 470 };
const read = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* 이번 실행만 */ } };
const viewport = (): Rect => ({ x: 0, y: 0, w: window.innerWidth, h: window.innerHeight });

/**
 * 앱 안 대화창 상태 — 배지는 앱 안에 없다(바탕 배지 창 하나, DeskBubble). 띠 프사·팀 보관함 '내 참모에게'로 놓거나 팀 화면에서 준 파일(openWith)이
 * 참모 채팅 칸이 가려진 화면(팀 모드·홈 — covered)에서 그 칸을 떠 있는 창으로 띄운다. 칸이 다시 보이면 닫는다(같은 채팅을 둘로 띄우지 않는다)
 */
export function useOrchBubble({ orchs, face, covered, onPick, onGo, storeKey = 'orchBubble' }: {
  orchs: BubbleOrch[];
  /** 대화창 참모(domain/orchBubble bubbleFace) */
  face: BubbleOrch | null;
  covered: boolean;
  /** 그 참모 채팅 탭으로(대화창 머리 얼굴) */
  onPick: (id: string) => void;
  /** 참모 화면으로 — 팀 모드·홈을 떠나 그 참모 화면 */
  onGo: (id: string) => void;
  storeKey?: string;
}) {
  const [open, setOpen] = useState(false);
  const [big, setBig] = useState(() => read(`${storeKey}.big`) === '1');
  const [box, setBox] = useState(viewport);
  useEffect(() => {
    const on = () => setBox(viewport());
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  // 칸이 다시 보이면(팀 모드를 나감 등) 대화창은 닫는다 — 같은 채팅이 칸과 창 둘에 있을 수 없다
  useEffect(() => { if (!covered) setOpen(false); }, [covered]);
  // 띠 프사·팀 보관함 '내 참모에게'로 놓은 것 — 대화창을 그 참모로 연다(dragPath ORCH_DROPPED)
  const coveredRef = useRef(covered);
  coveredRef.current = covered;
  const pickRef = useRef(onPick);
  pickRef.current = onPick;
  useEffect(() => {
    const on = (e: Event) => { const id = (e as CustomEvent<{ id: string }>).detail?.id; if (!id) return; pickRef.current(id); if (coveredRef.current) setOpen(true); };
    window.addEventListener(ORCH_DROPPED, on);
    return () => window.removeEventListener(ORCH_DROPPED, on);
  }, []);
  // 대화창은 오른쪽 아래(예전 앱 안 배지 자리)에서 펼친다
  const at = placeOf(readAnchor(read(`${storeKey}.pos`)), box);
  const flip = () => setBig((b) => { write(`${storeKey}.big`, b ? '0' : '1'); return !b; });
  const name = face?.label ?? '';
  const head = face && (
    <>
      <div className="obb-faces" role="tablist" aria-label={tr('참모 고르기', 'Pick an assistant')}>
        {orchs.map((o) => (
          <button key={o.id} type="button" role="tab" aria-selected={o.id === face.id} className={`obb-face${o.id === face.id ? ' on' : ''}`}
            style={orchVars(o.color) as React.CSSProperties} title={o.label} aria-label={o.label} onClick={() => onPick(o.id)}>
            <span className="obb-clip">{o.small}</span>{o.pip && o.pip !== 'rest' && <i className={`obb-pip p-${o.pip}`} aria-hidden="true" />}
          </button>
        ))}
      </div>
      <span className="obb-tools">
        <IconButton size="s" label={big ? tr('작게', 'Smaller') : tr('키우기', 'Bigger')} onClick={flip}>{big ? <IconRestore /> : <IconMaximize />}</IconButton>
        <IconButton size="s" label={tr('참모 화면으로', 'Open in assistant view')} onClick={() => { setOpen(false); onGo(face.id); }}><IconDockIn /></IconButton>
        <IconButton size="s" label={tr('접기', 'Collapse')} onClick={() => setOpen(false)}><IconMinimize /></IconButton>
      </span>
    </>
  );
  const float: BubbleFloat = open && covered && face ? { rect: popPlace({ x: at.x, y: at.y, w: BADGE, h: BADGE }, box, POP, big), head, label: tr(`${name} 대화창`, `${name} chat`) } : null;
  return { float, open: !!float, close: () => setOpen(false), openWith: (id: string) => { onPick(id); if (covered) setOpen(true); } };
}

/** 메인 창이 지금 배지 얼굴을 적는 자리 — 메신저 따로 창 배지가 읽는다(같은 출처 localStorage, 다른 창은 storage 사건). 배지를 끄면 지운다 */
export const FACE_KEY = 'orchBubble.face';
export const publishFace = (id: string | null) => { try { if (id) localStorage.setItem(FACE_KEY, id); else localStorage.removeItem(FACE_KEY); } catch { /* 따로 창 배지만 안 뜬다 */ } };
export function useFace(): string | null {
  const [id, setId] = useState(() => read(FACE_KEY));
  useEffect(() => {
    const st = (e: StorageEvent) => { if (e.key === FACE_KEY || e.key === null) setId(read(FACE_KEY)); };
    window.addEventListener('storage', st);
    return () => window.removeEventListener('storage', st);
  }, []);
  return id;
}
