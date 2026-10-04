// 설정 > 음성 — macOS 목소리 / Supertonic(고를 때 받기) / 직접 입력. 저장은 음성 명령 한 줄(domain/tts)
import { useEffect, useState } from 'react';
import { nativeVoicesList, supertonicInstall, supertonicStatus, ttsTest, ttsWarm, type SupertonicStatus } from '../data/tauri';
import { nativeVoices, readTts, SUPERTONIC_VOICES, ttsCommand, type TtsChoice, type TtsEngine } from '../domain/tts';
import { getLang, tr } from '../i18n';
import { IS_WIN } from '../domain/reader';

type Props = { value: string; onChange: (command: string) => void; name: string; onError: (e: string) => void };

export function TtsField({ value, onChange, name, onError }: Props) {
  const [st, setSt] = useState<SupertonicStatus | null>(null);
  const [voices, setVoices] = useState<string[]>([]);
  const [installing, setInstalling] = useState(false);
  const [custom, setCustom] = useState(''); // 직접 입력으로 돌아왔을 때 적던 것
  const [testing, setTesting] = useState(false);
  const [forceCustom, setForceCustom] = useState(false); // "say" 처럼 다른 칸으로 읽히는 명령도 직접 입력으로 고칠 수 있게
  useEffect(() => {
    void supertonicStatus().then(setSt).catch(() => {});
    void nativeVoicesList().then((l) => setVoices(nativeVoices(l, getLang() === 'en' ? 'en' : 'ko'))).catch(() => {});
  }, []);
  const test = async () => {
    setTesting(true);
    try {
      await ttsTest(value, tr(`안녕하세요, ${name}예요.`, `Hi, I'm ${name}.`));
    } catch (e: unknown) {
      onError(String(e));
    } finally {
      setTesting(false);
    }
  };
  const runner = st?.runner ?? '';
  const parsed = readTts(value, runner || '\0');
  const choice: TtsChoice = forceCustom ? { engine: 'custom', voice: '', command: value } : parsed;
  // 고른 macOS 목소리를 소리 없이 미리 불러 둔다 — 처음 쓰는 목소리는 "들어보기"가 몇 초 늦었다(직접 입력은 칠 때마다라 안 한다)
  const warmKey = choice.engine === 'native' ? value : '';
  useEffect(() => { if (warmKey) void ttsWarm(warmKey).catch(() => {}); }, [warmKey]);
  const pick = (c: TtsChoice) => { setForceCustom(false); onChange(ttsCommand(c, runner)); };
  const engine = (e: TtsEngine) => {
    if (choice.engine === 'custom') setCustom(choice.command);
    if (e === 'native') pick({ engine: 'native', voice: '', command: '' });
    if (e === 'supertonic') pick({ engine: 'supertonic', voice: 'M1', command: '' });
    if (e === 'custom') { setForceCustom(true); onChange(custom || value); }
  };
  const install = async () => {
    setInstalling(true);
    try {
      await supertonicInstall();
      const s = await supertonicStatus();
      setSt(s);
      if (s.ready) { setForceCustom(false); onChange(ttsCommand({ engine: 'supertonic', voice: 'M1', command: '' }, s.runner)); }
    } catch (e: unknown) {
      onError(tr(`Supertonic 받기 실패: ${String(e)}`, `Supertonic download failed: ${String(e)}`));
    } finally {
      setInstalling(false);
    }
  };
  const radio = (e: TtsEngine, label: string, disabled = false) => (
    <label className="su-tts-opt">
      <input type="radio" name="tts" checked={choice.engine === e} disabled={disabled} onChange={() => engine(e)} />
      <span>{label}</span>
    </label>
  );

  return (
    <div className="su-field su-field-list">
      <div className="su-list-row">
        <span className="su-label">{tr('음성', 'Voice')}</span>
        <div className="su-tts">
          <div className="su-tts-row">
            {radio('native', IS_WIN ? tr('Windows 목소리', 'Windows voice') : tr('macOS 목소리', 'macOS voice'))}
            {choice.engine === 'native' && (
              <select value={choice.voice} onChange={(e) => pick({ engine: 'native', voice: e.target.value, command: '' })}>
                <option value="">{tr('시스템 기본', 'System default')}</option>
                {voices.map((v) => <option key={v} value={v}>{v}</option>)}
              </select>
            )}
          </div>
          {!IS_WIN && <div className="su-tts-row">
            {radio('supertonic', tr('Supertonic — 더 자연스러운 목소리', 'Supertonic — a more natural voice'), !st?.ready)}
            {choice.engine === 'supertonic' && (
              <select value={choice.voice} onChange={(e) => pick({ engine: 'supertonic', voice: e.target.value, command: '' })}>
                {SUPERTONIC_VOICES.map((v) => <option key={v} value={v}>{v}</option>)}
              </select>
            )}
            {st && !st.ready && (
              <button type="button" className="btn su-mini" disabled={installing} onClick={() => void install()}>
                {installing ? tr('받는 중… 몇 분 걸려요', 'Downloading… takes a few minutes') : tr('받기 (약 550MB)', 'Download (about 550 MB)')}
              </button>
            )}
          </div>}
          <div className="su-tts-row">
            {radio('custom', tr('직접 입력', 'Custom command'))}
            {choice.engine === 'custom' && (
              <input value={choice.command} placeholder="say" onChange={(e) => onChange(e.target.value)} spellCheck={false} />
            )}
          </div>
          <div className="su-tts-row">
            <button type="button" className="btn" disabled={testing} onClick={() => void test()}>{testing ? tr('읽는 중…', 'Speaking…') : tr('들어보기', 'Test')}</button>
          </div>
          {!IS_WIN && <div className="su-hint">{tr(
            'Supertonic 은 이 맥에서 바로 읽어요(인터넷 필요 없음, 한 문장 1~2초). 받기를 누르면 파이썬 패키지와 목소리 모델(Supertone, OpenRAIL-M 라이선스)을 이 맥에 내려받아요.',
            'Supertonic speaks right on this Mac (no internet, 1–2 s per sentence). Download fetches a Python package and the voice model (Supertone, OpenRAIL-M license) to this Mac.',
          )}</div>}
        </div>
      </div>
    </div>
  );
}
