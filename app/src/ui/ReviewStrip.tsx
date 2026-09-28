// 작업 패널 맨 위 — 평소엔 여기만 본다(시안 D안): 사용자 확인 조건에 걸린 열린 PR + 오늘 넣은 것. 누르면 사이드바 '리뷰' 화면의 그 PR
import { useState } from 'react';
import { GATE_LABEL } from '../domain/review';
import { splitOpen } from '../domain/reviewSummary';
import { ago, hm } from './ReviewPage';
import { Row, Sec } from './TaskPanel';
import type { ReviewData } from './useReview';
import { tr } from '../i18n';

const SHOW = 6;

export function ReviewStrip({ data, onOpen }: { data: ReviewData; onOpen: (key: string) => void }) {
  const [showMerged, setShowMerged] = useState(true);
  const now = Date.now();
  const { confirm, old } = splitOpen(data.open, data.later, now);
  return (
    <>
      <Sec title={tr('머지 전에 볼 것', 'Check before merge')} count={confirm.length} tone={confirm.length ? 'hot' : undefined} />
      {data.error && <div className="tempty">{tr('GitHub 읽기 실패 — 리뷰 탭에서 새로고침', 'Failed to read GitHub — refresh in the Review tab')}</div>}
      {!data.error && confirm.length === 0 && <div className="tempty">{data.scannedAt ? tr('직접 볼 PR 이 없어', 'No PRs for you to check') : tr('PR 읽는 중…', 'Reading PRs…')}</div>}
      {confirm.map((p) => (
        <Row key={p.key} dot="needsInput" name={p.folder} line={`#${p.number} ${p.title}`}
          sub={p.gates.map((g) => `${GATE_LABEL[g.kind]} ${g.why}`).join(' · ')} when={ago(p.updatedAt, now)} onClick={() => onOpen(p.key)} />
      ))}
      {old.length > 0 && <button className="tempty linkish" onClick={() => onOpen(old[0]!.key)}>{tr(`2주 넘게 멈춘 PR ${old.length}개 — 리뷰 탭에서`, `${old.length} PRs stalled over 2 weeks — see Review tab`)}</button>}

      <Sec title={tr('오늘 넣은 것', 'Merged today')} count={data.merged.length} open={showMerged} onToggle={() => setShowMerged((v) => !v)} />
      {showMerged && data.merged.slice(0, SHOW).map((m) => (
        <Row key={m.key} dot="replied" name={m.folder} line={`#${m.number} ${m.title}`}
          sub={data.reverts[m.key] ? tr(`revert PR #${data.reverts[m.key]!.number} 만듦 — 확인 뒤 머지`, `Opened revert PR #${data.reverts[m.key]!.number} — merge after checking`) : undefined} when={hm(m.mergedAt)} onClick={() => onOpen(m.key)} />
      ))}
      {showMerged && data.merged.length > SHOW && <button className="tempty linkish" onClick={() => onOpen(data.merged[SHOW]!.key)}>{tr(`나머지 ${data.merged.length - SHOW}개 — 리뷰 탭에서 (되돌리기도 거기서)`, `${data.merged.length - SHOW} more — see Review tab (revert there too)`)}</button>}
    </>
  );
}
