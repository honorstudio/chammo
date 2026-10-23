// 대화 목록(메신저 따로 창 가운데 줄·폰 팀 탭) — 사람마다 한 줄: 프사 · 이름 · 마지막 말 · 시각 · 안 읽은 수.
// 단톡방은 서버 길이 아직 없어 줄이 없다(roadmap)
import { previewOf, stamp, type Convo } from '../../domain/teamChat';
import { tr } from '../../i18n';
import { Person, Unread } from './TeamFaces';
import './team.css';

export function TeamList({ convos, sel, onPick }: { convos: Convo[]; sel: string | null; onPick: (c: Convo) => void }) {
  const now = Date.now();
  if (!convos.length) return <div className="tmx-none">{tr('아직 팀에 다른 사람이 없어요 — 초대 링크를 보내 봐요', 'Nobody else in the team yet — send an invite link')}</div>;
  return (
    <>
      {convos.map((c) => (
        <button key={c.key} className={`tmx-li ${sel === c.key ? 'on' : ''}`} onClick={() => onPick(c)} aria-current={sel === c.key || undefined}>
          <Person name={c.name} color={c.color} size={30} />
          <span className="tmx-tx"><b>{c.name}</b><span>{previewOf(c.last)}</span></span>
          <span className="tmx-r">{c.last ? stamp(c.last.at, now) : ''}<Unread n={c.unread} inline /></span>
        </button>
      ))}
    </>
  );
}
