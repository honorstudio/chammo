// 실행될 수 있는 팀 파일을 열기 전 글자 확인(보안 점검 H-1) — 보관함 줄·대화 풍선·팀 홈·받은 파일 줄이 같이 쓴다. 되돌리기 어려운 동작이라 아이콘 말고 글자.
// 칸·화면마다 상태를 두지 않고 부르는 곳에서 바로 기다린다. 초점은 취소에 — 치던 Enter 가 그대로 '열기'가 되지 않게
import { createRoot } from 'react-dom/client';
import { tr } from '../../i18n';
import { Confirm } from '../OrchDialogs';

export const confirmRunnable = (name: string) => new Promise<boolean>((resolve) => {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const done = (ok: boolean) => { root.unmount(); host.remove(); resolve(ok); };
  const body = tr('열면 이 컴퓨터에서 프로그램이 돌면서 내 파일과 계정에 손댈 수 있어요. 팀원 기기가 해킹됐을 수도 있으니, 보낸 사람에게 직접 확인해 보세요.', "Opening it lets a program run on this computer and reach your files and accounts. A teammate's device may have been hacked, so check with the sender first.");
  root.render(<Confirm title={tr('프로그램이 실행될 수 있는 파일이에요', 'This file can run a program')} body={`${name}\n\n${body}`} ok={tr('그래도 열기', 'Open anyway')} danger focusCancel onOk={() => done(true)} onCancel={() => done(false)} />);
});
