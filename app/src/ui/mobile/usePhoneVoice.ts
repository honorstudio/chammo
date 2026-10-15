// 폰이 앞에 떠 있는 동안 음성 모드가 켜져 있으면 맥에 하트비트를 보낸다 — 화면 어디에 있든(채팅 시트가 안 열려 있어도) 앱이 떠 있는 동안
import { useEffect } from 'react';
import { readVoice } from '../../data/web';
import { setPhoneVoice } from '../../data/phoneVoice';
import { useMemoPoll } from './usePoll';

export function usePhoneVoice(): void {
  const [on] = useMemoPoll('voice', readVoice, 15_000, false);
  useEffect(() => { setPhoneVoice(on); }, [on]);
}
