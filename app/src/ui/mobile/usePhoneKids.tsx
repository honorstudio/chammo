// 보호자 폰·패드 채팅에 아이 화면 대화와 '오늘 만든 것' 줄(아홉째 조각 — 사용자은 아이패드로 보호자 화면을 쓴다).
// 데스크톱 useKidsChat 과 같은 줄·같은 카드(domain/kids·kidsToday, ui/kids/KidsTodayCard). 키즈 참모 채팅을 보는 동안만, 화면이 보일 때만 6초마다
import { useEffect, useState } from 'react';
import { kidsToday as fetchToday, kidsWorkGuardian } from '../../data/web';
import { kidsLines, type KidsLine } from '../../domain/kids';
import { kidsToday } from '../../domain/kidsToday';
import { tr } from '../../i18n';
import { KidsTodayCard } from '../kids/KidsTodayCard';

const EVERY = 6000;
type Got = Awaited<ReturnType<typeof fetchToday>>;

function KidRow({ l, child }: { l: KidsLine; child: string }) {
  if (l.kind === 'app') return <div className="m-kid-app"><b>{tr('아이 화면', 'Kids screen')}</b><span>{l.text}</span></div>;
  return <div className="m-kid"><div className="m-kid-who">{l.kind === 'kid' ? child || tr('아이', 'Child') : tr('아이 화면 답', 'Kids screen reply')}</div><div className="m-kid-text">{l.text}</div></div>;
}

export function usePhoneKids(kidsKey: string | undefined) {
  const [got, setGot] = useState<Got | null>(null);
  useEffect(() => {
    setGot(null);
    if (!kidsKey) return;
    let live = true;
    const pull = () => { if (document.visibilityState === 'visible') void fetchToday(kidsKey).then((g) => { if (live) setGot((o) => (JSON.stringify(o) === JSON.stringify(g) ? o : g)); }, () => {}); };
    pull();
    const i = setInterval(pull, EVERY);
    return () => { live = false; clearInterval(i); };
  }, [kidsKey]);
  if (!kidsKey || !got) return { extras: [], today: null };
  // 자르지 않는다(clip 없음) — 보호자 대화가 비었거나 아이가 먼저 말했으면 첫 말 앞 줄이 통째로 사라졌다(하네스로 확인). 데스크톱 useKidsChat 과 같이 시각 자리에 다
  const extras = kidsLines(got.rows).map((l) => ({ ts: l.ts, key: l.key, node: <KidRow l={l} child={got.child} /> }));
  const t = kidsToday(got.rows, got.works, got.time, new Date().setHours(0, 0, 0, 0));
  const today = t ? <div className="m-kt"><KidsTodayCard today={t} child={got.child} open={(name) => kidsWorkGuardian(kidsKey, name)} /></div> : null;
  return { extras, today };
}
