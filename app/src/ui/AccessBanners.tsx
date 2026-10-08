import { accessBanner, copiesNote, FULL_DISK_URL, type Access, type Copies } from '../domain/access';
import { tildify } from '../domain/setup';
import { openTarget } from '../data/tauri';
import { tr } from '../i18n';
import { IconClose } from './Icons';

/** 프로젝트 폴더가 막혔을 때·같은 앱 여러 벌일 때 앱 위 띠(이슈 #1). 판단은 domain/access.ts */
export function AccessBanners({ access, copies, home, accessDismissed, copiesDismissed, onDismissAccess, onDismissCopies }: {
  access: Access | null;
  copies: Copies | null;
  home: string;
  accessDismissed: string | null;
  copiesDismissed: string | null;
  onDismissAccess: (dir: string) => void;
  onDismissCopies: (key: string) => void;
}) {
  return (
    <>
      {(() => {
        const b = accessBanner(access, accessDismissed);
        if (!b) return null;
        const dir = tildify(b.dir, home);
        return (
          <div className="banner warn" role="alert">
            <span>{b.kind === 'mac'
              ? tr(`맥이 프로젝트 폴더(${dir}) 접근을 막고 있어 세션을 못 띄워요. 전체 디스크 접근 권한에서 Chammo 를 켠 뒤 앱을 다시 켜 주세요.`, `macOS is blocking the projects folder (${dir}), so sessions can't start. Turn on Chammo in Full Disk Access, then reopen the app.`)
              : tr(`프로젝트 폴더(${dir})를 읽을 권한이 없어 세션을 못 띄워요. 폴더 권한을 확인해 주세요.`, `No permission to read the projects folder (${dir}), so sessions can't start. Check the folder's permissions.`)}</span>
            {b.kind === 'mac' && <button className="btn pri" onClick={() => void openTarget('url', FULL_DISK_URL).catch(() => {})}>{tr('설정 열기', 'Open Settings')}</button>}
            <button className="ib" aria-label={tr('닫기', 'Dismiss')} title={tr('닫기', 'Dismiss')} onClick={() => onDismissAccess(b.dir)}><IconClose /></button>
          </div>
        );
      })()}
      {(() => {
        const n = copiesNote(copies, copiesDismissed);
        if (!n) return null;
        const lines = [
          ...(n.running.length ? [tr(`Chammo 가 또 떠 있어요: ${n.running.join(', ')} — 하나만 남기고 꺼 주세요.`, `Another Chammo is running: ${n.running.join(', ')} — quit all but one.`)] : []),
          ...(n.installed.length ? [tr(`Chammo 가 여러 벌 깔려 있어요: ${n.installed.join(', ')} — 안 쓰는 건 지워 주세요(맥 권한이 섞여요).`, `More than one Chammo is installed: ${n.installed.join(', ')} — delete the ones you don't use (macOS permissions get mixed up).`)] : []),
          ...(n.fromDmg ? [tr('디스크 이미지에서 바로 켰어요 — 응용 프로그램 폴더로 옮겨서 켜 주세요.', 'Chammo is running from the disk image — move it to Applications and open it from there.')] : []),
        ];
        return (
          <div className="banner warn">
            <span>{lines.join(' ')}</span>
            <button className="ib" aria-label={tr('닫기', 'Dismiss')} title={tr('닫기', 'Dismiss')} onClick={() => onDismissCopies(n.key)}><IconClose /></button>
          </div>
        );
      })()}
    </>
  );
}
