/** pty 번호를 받기 전에 쓴 글을 모아 뒀다가 번호를 받는 순간 한 번에 보낸다.
 * 윈도우 가짜 콘솔(ConPTY)은 처음에 "커서 어디?"(ESC[6n)를 묻고 답이 올 때까지 자식을 안 띄운다 — 그 질문이
 * pty_open 답보다 먼저 오면 xterm 의 답이 버려져 콘솔이 영영 멈췄다(2026-10-05 윈도우 QA, 폰에서 보낸 글이 그 창으로 사라짐) */
const MAX = 64 * 1024;

export function pendingWrites(send: (id: number, d: string) => void) {
  let id: number | null = null;
  let queued = '';
  let closed = false;
  return {
    write(d: string) {
      if (closed) return;
      if (id != null) return send(id, d);
      queued = (queued + d).slice(-MAX);
    },
    open(n: number) {
      if (closed) return;
      id = n;
      if (queued) send(n, queued);
      queued = '';
    },
    close() {
      closed = true;
      queued = '';
    },
  };
}
