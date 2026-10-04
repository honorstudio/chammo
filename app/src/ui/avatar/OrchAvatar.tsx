// 참모 프사 하나 — 번호 칩 자리 전부(사이드바 22·겹침 16·대시보드 44·채팅 탭 18). 모바일도 이걸 가져다 쓴다(ui/avatar/index.ts)
import { useEffect, useRef, useState } from 'react';
import { tr } from '../../i18n';
import { avatarClasses, avatarKey, type AvatarTone, defaultAvatar, jitter, resolveAvatar, transitionOf, type Avatar, type AvatarState, type Crop, type Transition } from '../../domain/avatar';
import { PresetSvg } from './shapes';
import { imageUrl, useAvatars } from './store';
import { blinkWatch } from './blink';
import { bindAttention } from '../attention';
import './avatar.css';

const STATE_WORD: Record<AvatarState, () => string> = {
  work: () => tr('일하는 중', 'Working'), rest: () => tr('쉼', 'Idle'), ask: () => tr('물어봄', 'Asking'), off: () => tr('꺼짐', 'Stopped'),
};

// 화면 밖이면 멈춘다 — 관찰자 하나를 모두가 나눠 쓴다(사이드바에 여럿 떠도 타이머 0)
let io: IntersectionObserver | null = null;
function watch(el: Element): () => void {
  if (typeof IntersectionObserver === 'undefined') return () => {};
  io ??= new IntersectionObserver((es) => es.forEach((e) => e.target.classList.toggle('oa-hidden', !e.isIntersecting)));
  io.observe(el);
  return () => io?.unobserve(el);
}
const reduced = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** 상태가 바뀌면 전환 동작을 잠깐(1초, 웃는 눈은 1.9초) */
function useTransition(state: AvatarState): Transition | null {
  const prev = useRef(state);
  const [t, setT] = useState<Transition | null>(null);
  useEffect(() => {
    const next = transitionOf(prev.current, state);
    prev.current = state;
    if (!next) return;
    setT(next);
    const id = window.setTimeout(() => setT(null), next === 'joy' ? 1900 : 1000);
    return () => window.clearTimeout(id);
  }, [state]);
  return t;
}

export const cropTransform = (c: Crop) => `translate(${(c.x * (c.zoom - 1) * 50).toFixed(2)}%, ${(c.y * (c.zoom - 1) * 50).toFixed(2)}%) scale(${c.zoom})`;

/** GIF 는 동작 줄이기면 첫 장면만(캔버스에 한 번 그림) */
function Picture({ src, crop, onError }: { src: string; crop: Crop; onError: () => void }) {
  const still = reduced() && /\.gif(\?|$)/i.test(src);
  const cv = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!still) return;
    const img = new Image();
    img.onload = () => { const c = cv.current; if (!c) return; c.width = img.naturalWidth; c.height = img.naturalHeight; c.getContext('2d')?.drawImage(img, 0, 0); };
    img.onerror = onError;
    img.src = src;
  }, [still, src, onError]);
  const style = { transform: cropTransform(crop) };
  return still ? <canvas ref={cv} style={style} /> : <img src={src} alt="" draggable={false} style={style} onError={onError} />;
}

export function OrchAvatar({ name, size, state, color, label, preview, previewSrc, className, tone }: {
  /** 세션 이름 그대로 — 별명은 떼고 기본 이름으로 찾는다 */
  name: string;
  size: number;
  state: AvatarState;
  /** 저장한 색이 없을 때 — 참모 순서 색 */
  color: string;
  /** 읽어 줄 이름(별명 포함). 없으면 기본 이름 */
  label?: string;
  /** 고르기 창 미리보기 — 저장 전 값 */
  preview?: Avatar;
  previewSrc?: string;
  className?: string;
  /** 참모 색 면 위에 놓일 때 — 몸 흰색·눈 면 색(고른 탭 알약은 CSS 가 알아서 한다) */
  tone?: AvatarTone;
}) {
  const { saved, dataDir } = useAvatars();
  const key = avatarKey(name);
  const av = preview ?? resolveAvatar(saved, name);
  const t = useTransition(state);
  const root = useRef<HTMLSpanElement>(null);
  const [broken, setBroken] = useState(false);
  // 사람이 안 보면(창 숨김·다른 앱이 앞·입력 2분 없음) 전부 멈춘 그림 — ui/attention 이 문서 맨 위에 oa-paused
  useEffect(() => {
    bindAttention();
    const el = root.current;
    if (!el) return;
    const a = watch(el);
    const b = blinkWatch(el);
    return () => { a(); b(); };
  }, []);
  const src = av.kind === 'image' ? (previewSrc ?? imageUrl(dataDir, saved.get(key))) : null;
  useEffect(() => setBroken(false), [src]);
  const j = jitter(key);
  const fill = av.kind === 'preset' && av.color ? av.color : color;
  const showImage = av.kind === 'image' && src && !broken;
  const cls = avatarClasses({ image: !!showImage, state, transition: t, size, tone }) + (className ? ` ${className}` : '');
  const style = { '--oa-s': `${size}px`, '--oa-body': fill, '--oa-d': `${j.delay.toFixed(2)}s`, '--oa-k': j.k.toFixed(3) } as React.CSSProperties;
  const aria = `${label ?? key} · ${STATE_WORD[state]()}`;
  return (
    <span ref={root} className={cls} style={style} role="img" aria-label={aria}>
      {showImage && av.kind === 'image'
        ? <span className="oa-pic"><Picture src={src} crop={av.crop} onError={() => setBroken(true)} /></span>
        : <PresetSvg shape={av.kind === 'preset' ? av.shape : defaultAvatar(key).shape} eyes={av.kind === 'preset' ? av.eyes : 'pill'} />}
    </span>
  );
}
