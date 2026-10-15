// 참모를 깨우는·새로 켜는 동안 참모 채팅 입력칸 위 한 줄(2026-10-12 rail-wake) — 깨어나는 작은 프사 + 글(domain/railRows wakeNotice)
import { orchColor } from '../../domain/avatar';
import { wakeNotice } from '../../domain/railRows';
import { OrchAvatar } from '../avatar';

/** name = 진짜 세션 이름(프사 찾기), label = 화면 이름, waking = 쉬는 참모 깨우기(아니면 새로 켜기) */
export function WakeNotice({ name, label, waking }: { name: string; label: string; waking: boolean }) {
  return (
    <>
      <OrchAvatar name={name} size={18} state="off" phase="starting" color={orchColor(name)} label={label} />
      <span>{wakeNotice(label, waking)}</span>
    </>
  );
}
