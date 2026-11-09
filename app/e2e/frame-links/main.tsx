// 시안 칸 링크 해피패스 E2E 받침 — 진짜 HtmlFrame(링크 듣기·칸 지킴이)·openFrameLink·openLinkIn 에 가짜 invoke(index.html)만.
// 스페이스 glue(SpaceView __openLink)는 같은 openLinkIn 을 부른다 — 여기선 맡긴 세션 없음 = 참모 브라우저 길
import '../../src/ui/layers.css';
import '../../src/ui/styles.css';
import '../../src/ui/reader/reader.css';
import { createRoot } from 'react-dom/client';
import { HtmlFrame } from '../../src/ui/reader/Reader';
import { openLinkIn } from '../../src/ui/space/openLink';

const w = window as unknown as { __shown: string[]; __openLink: (url: string, doc: string, frame: Element) => boolean };
w.__shown = [];
w.__openLink = (url, doc, frame) => {
  if (!frame.closest('.space, .dash-preview')) return false;
  void openLinkIn(url, doc, { held: [], devRoot: async () => '/dev', shown: (p) => w.__shown.push(p), hqOpened: () => {}, fail: (e) => w.__shown.push(`fail:${String(e)}`) });
  return true;
};
const doc = new URLSearchParams(location.search).get('doc') ?? 'doc.html';
createRoot(document.getElementById('root')!).render(
  <div className="space" style={{ height: '100vh', display: 'flex' }}><div className="rd-zoombox"><HtmlFrame className="rd-frame" src={`/${doc}`} zoom={100} /></div></div>,
);
