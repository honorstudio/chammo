// Claude Code 새 판이 맥 폴더 권한 창 답을 기다리는 것 같으면 판마다 한 번 알린다(맥 알림·폰 푸시). 창은 앱이 대신 못 누른다
// 2026-11-04: 답 없이 7시간 — 그동안 세션 파일 접근이 멈추고, 끝엔 앱 재시작까지 113분 멈췄다(folder_prompt.rs)
import { useEffect } from 'react';
import { claudeFolderPrompt } from '../data/tauri';
import { tr } from '../i18n';
import { notifyOnce } from './notifier';

const TICK = 120_000;

export function useFolderPrompt() {
  useEffect(() => {
    const told = new Set<string>();
    let busy = false; // 맥이 멈춘 동안 답이 늦어도 부름을 쌓지 않는다
    const step = async () => {
      if (busy) return;
      busy = true;
      const p = await claudeFolderPrompt().catch(() => null);
      busy = false;
      if (!p || told.has(p.version)) return;
      told.add(p.version);
      const where = p.folder === 'desktop' ? tr('데스크톱', 'Desktop') : tr('문서', 'Documents');
      notifyOnce({
        kind: 'lost', session: `folder-prompt:${p.version}`, orch: false, go: 'latest',
        title: tr(`${where} 폴더 허용 창이 떠 있을 수 있어요`, `A ${where} access prompt may be waiting`),
        body: tr(`맥에서 ${where} 폴더 접근을 묻는 창에 답하기 전까지 참모들이 파일을 읽지 못하고 멈춰요. 화면에서 '허용'을 눌러 주세요.`, `Your assistants can't read files in ${where} until you answer the Mac prompt, and they may stall. Click Allow on your screen.`),
      });
    };
    void step();
    const t = window.setInterval(() => void step(), TICK);
    return () => window.clearInterval(t);
  }, []);
}
