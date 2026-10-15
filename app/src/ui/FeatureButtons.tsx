// 기록·음성·도구·하니터·리뷰 단추 — 터미널 뷰는 위 막대(TopBar), 채팅 뷰는 왼쪽 참모 패널(접힌 패널 둘째 줄·펼친 패널 맨 아래)이
// 같은 단추를 쓴다(2026-10-11 사용자 180.png). 켜짐(음성 켜짐의 검은 면 등)은 on 클래스 그대로
import type { BarItem } from '../domain/topbarMenu';
import { assistant, tr } from '../i18n';
import { IconHarness, IconReplay, IconReview, IconSpeaker, IconTools } from './Icons';
import { Badge } from './kit/Badge';

export type FeatureProps = {
  voice: boolean; onVoice: () => void;
  replayOn: boolean; onReplay: () => void;
  /** 도구 화면이 지금 탭에 떠 있나 */
  tools: boolean; onTools: () => void;
  harnitor: boolean; onHarnitor: () => void;
  /** 리뷰 — on = 리뷰 화면이 떠 있나, confirm = 머지 전에 사람이 볼 PR 수 */
  review: { on: boolean; confirm: number }; onReview: () => void;
};

/** 기능 단추 하나 — cls = 놓이는 자리 모양(위 막대 'voice', 참모 패널 'rail-fn'). 기능 단추가 아니면 null */
export function featureButton(id: BarItem, p: FeatureProps, cls: string, tip = false): React.ReactNode {
  const c = (on: boolean, more = '') => [cls, more, on ? 'on' : ''].filter(Boolean).join(' ');
  // 띠 안(tip)에선 기본 title 대신 띠 호버 카드에 이름만(2026-10-12 — title 은 1초 넘게 걸렸다)
  const t = (title: string, label: string) => (tip ? { 'data-tip': label } : { title });
  switch (id) {
    case 'replay': return <button key="replay" className={c(p.replayOn)} {...t(tr('하루 리플레이 — 오늘 한 일 돌려보기', "Day replay — replay today's work"), tr('하루 리플레이', 'Day replay'))} aria-label={tr('하루 리플레이', 'Day replay')} aria-pressed={p.replayOn} onClick={p.onReplay}><IconReplay /></button>;
    case 'voice': return <button key="voice" className={c(p.voice)} {...t(p.voice
      ? tr(`음성 모드 켜짐 — ${assistant()}가 답하면 소리로 읽어줘 (눌러서 끄기)`, `Voice mode on — ${assistant()}'s replies are read aloud (click to turn off)`)
      : tr(`음성 모드 — ${assistant()} 답을 소리로 (눌러서 켜기)`, `Voice mode — read ${assistant()}'s replies aloud (click to turn on)`), tr('음성 모드', 'Voice mode'))} aria-label={tr('음성 모드', 'Voice mode')} aria-pressed={p.voice} onClick={p.onVoice}><IconSpeaker /></button>;
    case 'tools': return <button key="tools" className={c(p.tools)} {...t(p.tools ? tr('도구 닫기', 'Close tools') : tr('도구 — MCP·플러그인·스킬 보고 끄고 켜기', 'Tools — see and toggle MCP, plugins and skills'), tr('도구', 'Tools'))} aria-label={tr('도구', 'Tools')} aria-pressed={p.tools} onClick={p.onTools}><IconTools /></button>;
    // 하니터: 설정 버튼 자리 — 설정은 메뉴 Chammo > 설정…(⌘,)으로만(2026-10-01 사용자)
    case 'harnitor': return <button key="harnitor" className={c(p.harnitor)} {...t(p.harnitor ? tr('하니터 닫기', 'Close Harnitor') : tr('하니터 — 스킬·훅·MCP·플러그인 보기·끄고 켜기', 'Harnitor — view and toggle skills, hooks, MCP, plugins'), tr('하니터', 'Harnitor'))} aria-label={tr('하니터', 'Harnitor')} aria-pressed={p.harnitor} onClick={p.onHarnitor}><IconHarness /></button>;
    // 리뷰(PR) — 숫자는 머지 전에 볼 것이 있을 때만
    case 'review': return (
      <button key="review" className={c(p.review.on, 'rv-btn')} {...t(p.review.on ? tr('리뷰 닫기', 'Close review') : p.review.confirm ? tr(`리뷰 — 머지 전에 볼 것 ${p.review.confirm}개`, `Review — ${p.review.confirm} to check before merging`) : tr('리뷰', 'Review'), p.review.confirm ? tr(`리뷰 — 볼 것 ${p.review.confirm}`, `Review — ${p.review.confirm} to check`) : tr('리뷰', 'Review'))}
        aria-label={p.review.confirm ? tr(`리뷰, 볼 것 ${p.review.confirm}개`, `Review, ${p.review.confirm} to check`) : tr('리뷰', 'Review')} aria-pressed={p.review.on} onClick={p.onReview}>
        <IconReview />
        <Badge n={p.review.confirm} className="rv-n" />
      </button>
    );
    default: return null;
  }
}

/** 참모 패널 기능 줄 — 접힌 패널은 세로(둘째 줄), 펼친 패널은 맨 아래 가로 */
export function FeatureRow({ items, p, dir }: { items: BarItem[]; p: FeatureProps; dir: 'col' | 'row' }) {
  if (!items.length) return null;
  return <div className={`rail-fns ${dir}`} role="group" aria-label={tr('기능', 'Features')}>{items.map((id) => featureButton(id, p, 'rail-fn', true))}</div>;
}
