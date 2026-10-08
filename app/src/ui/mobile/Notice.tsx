// 폰 결과·오류 알림 — 시트·화면 맨 위 줄 대신 가운데 작은 모달(2026-10-05 사용자). 닫기 아이콘·바깥 누름으로 닫히고,
// 정보는 읽을 만큼 뒤 저절로(domain/notice), 오류·할 일(children)이 붙은 안내는 사람이 닫을 때까지.
// 시트(.m-pick)는 transform 이 걸려 있어 그 안의 fixed 가 시트에 갇힌다 — body 로 포털
import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { noticeCloseMs } from '../../domain/notice';
import { IconClose } from '../Icons';

export type NoticeMsg = { text: string; error: boolean };

export function Notice({ text, error, onClose, children }: NoticeMsg & { onClose: () => void; children?: ReactNode }) {
  const close = useRef(onClose);
  close.current = onClose;
  const ms = noticeCloseMs({ text, error, action: !!children });
  useEffect(() => {
    if (ms === null) return;
    const t = setTimeout(() => close.current(), ms);
    return () => clearTimeout(t);
  }, [text, ms]);
  return createPortal(
    <div className="m-notice-wrap">
      <button type="button" className="m-notice-back" aria-label="닫기" tabIndex={-1} onClick={onClose} />
      <div className={error ? 'm-notice m-notice-err' : 'm-notice'} role={error ? 'alertdialog' : 'dialog'} aria-modal="true" aria-label={error ? '오류' : '알림'}>
        <div className="m-notice-text" role={error ? 'alert' : 'status'}>{text}</div>
        <button type="button" className="m-notice-x" onClick={onClose} aria-label="닫기" title="닫기"><IconClose /></button>
        {children}
      </div>
    </div>,
    document.body,
  );
}
