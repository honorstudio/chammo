// 윈도우 채팅에 붙여 넣은 그림·파일 → <데이터>/attach 에 저장한 경로(공개 이슈 #19).
// 전엔 Alt+V 로 Claude 가 클립보드를 직접 읽게만 했는데, Claude 는 클립보드 '그림'만 읽어서 탐색기에서 복사한 그림 파일은
// #img1 글자만 가고 그림은 안 갔다(윈도우 시험 PC 0.4.10 재현). 웹뷰가 주는 파일 내용을 앱이 저장해 경로로 붙인다 — attach 사본은 보관함에도 들어간다
import { invoke } from '@tauri-apps/api/core';
import { tr } from '../../i18n';

/** 붙여넣기 한 파일 크기 끝 — 내용이 IPC 로 통째로 건너간다. 넘으면 끌어다 놓기로(경로만 건너가 크기 제한이 따로 있다) */
export const PASTE_MAX = 30 * 1024 * 1024;

type Save = (name: string, bytes: number[]) => Promise<string>;
const saveAttach: Save = (name, bytes) => invoke<string>('save_attach', { name, bytes });

/** 붙여 넣은 파일들을 저장 — 저장한 경로들과 못 한 것(이유). 이름이 없으면(화면 캡처) pasted.<확장자> */
export async function saveClipFiles(files: File[], save: Save = saveAttach): Promise<{ ok: string[]; bad: { from: string; error: string }[] }> {
  const ok: string[] = [];
  const bad: { from: string; error: string }[] = [];
  for (const f of files) {
    const ext = (f.type.split('/')[1] ?? 'png').replace('jpeg', 'jpg').replace(/[^a-z0-9]/gi, '') || 'png';
    const name = f.name && f.name !== 'image.png' ? f.name : `pasted.${ext}`;
    if (f.size > PASTE_MAX) {
      bad.push({ from: name, error: tr(`30MB 넘는 파일은 붙여넣을 수 없어요. 채팅 칸에 끌어다 놓아 주세요: ${name}`, `Files over 30 MB can't be pasted. Drag them into the chat instead: ${name}`) });
      continue;
    }
    try {
      ok.push(await save(name, Array.from(new Uint8Array(await f.arrayBuffer()))));
    } catch (e) {
      bad.push({ from: name, error: tr(`붙여 넣은 파일을 저장하지 못했어요(${String(e)}): ${name}`, `Couldn't save the pasted file (${String(e)}): ${name}`) });
    }
  }
  return { ok, bad };
}
