import { useEffect, useState } from 'react';
import { appCopies, projectAccess } from '../data/tauri';
import type { Access, Copies } from '../domain/access';

/** 프로젝트 폴더 읽기 점검 + 같은 앱 여러 벌 — 켤 때·창이 앞에 올 때·주기적으로(맥 권한은 재설치·이름 바꾸기로 언제든 풀린다, 이슈 #1).
 *  권한 창 답을 기다리는 동안(pending)은 자주 본다. 마법사를 마치기 전엔 안 본다(데스크탑을 건드리면 권한 창이 뜬다) */
export function useAccessWatch(on: boolean): { access: Access | null; copies: Copies | null } {
  const [access, setAccess] = useState<Access | null>(null);
  const [copies, setCopies] = useState<Copies | null>(null);
  useEffect(() => {
    if (!on) return;
    let stop = false;
    let t: ReturnType<typeof setTimeout> | undefined;
    const read = () => {
      clearTimeout(t);
      void projectAccess().then((a) => {
        if (stop) return;
        setAccess(a);
        t = setTimeout(read, a.state === 'pending' ? 5_000 : 60_000);
      }, () => { if (!stop) t = setTimeout(read, 60_000); });
    };
    const readCopies = () => void appCopies().then((c) => { if (!stop) setCopies(c); }, () => {});
    read();
    readCopies();
    const copiesTimer = setInterval(readCopies, 5 * 60_000);
    const onFocus = () => { read(); readCopies(); };
    window.addEventListener('focus', onFocus);
    return () => { stop = true; clearTimeout(t); clearInterval(copiesTimer); window.removeEventListener('focus', onFocus); };
  }, [on]);
  return { access, copies };
}
