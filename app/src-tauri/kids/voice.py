"""키즈 목소리 서버(넷째 조각) — 앱이 Supertonic 가상환경 파이썬으로 한 번 띄워 두고 한 줄씩 묻는다(모델 띄우기 1초를 매번 안 내게).
확정 목소리(사용자 11-17): F1 Supertonic 귀엽게(1.15배 높이기) + 합성 속도 0.85배(speed 0.765).
마무리 규칙(docs/design-drafts/kids-mode/speed/voice_final.py 그대로): 1.15배 높이기 전 저역 통과, 앞 무음 80ms·뒤 250ms·시작 5ms 페이드,
흘려 읽기는 말끝이 뚝 끊긴 덩어리만 50ms 코사인으로 줄이고, 미리 만든 말은 4번까지 다시 만들어 끝 사그라듦 50ms 이상인 판을 고른다.
들어오는 줄: {"op":"say","text":…,"out":…} · {"op":"pre","dir":…,"phrases":[…]}  나가는 줄: {"ok":true,…} 또는 {"ok":false,"err":…}
python voice.py <모델 폴더>"""
import json, os, sys, time, wave
import numpy as np
from supertonic import TTS

VOICE, SPEED, UP = 'F1', 0.765, 1.15
LEAD, TAIL = 0.08, 0.25
tts = TTS(model='supertonic-3', model_dir=sys.argv[1], auto_download=False)
st = tts.get_voice_style(voice_name=VOICE)
SR = tts.sample_rate


def env(x, ms=5):
    w = int(SR * ms / 1000); n = len(x) // w
    return np.sqrt(np.mean(x[:n * w].reshape(n, w) ** 2, axis=1)), w


def bounds(x):
    e, w = env(x); pk = e.max(); idx = np.where(e > pk * 0.01)[0]
    return idx[0] * w, (idx[-1] + 1) * w, e, pk


def fall_ms(x):
    _, end, e, pk = bounds(x); w = int(SR * 0.005)
    return (end // w - 1 - np.where(e > pk * 0.5)[0][-1]) * 5


def lowpass(x, cutoff):
    n = 101; t = np.arange(n) - (n - 1) / 2; h = np.sinc(2 * cutoff / SR * t) * np.hamming(n); h /= h.sum()
    return np.convolve(x, h, mode='same')


def finish(x, soften):
    x = lowpass(x, SR / 2 / UP * 0.92)
    x = np.interp(np.linspace(0, len(x) - 1, int(len(x) / UP)), np.arange(len(x)), x).astype(np.float32)
    a, b, _, _ = bounds(x)
    if soften and fall_ms(x) < 50:
        k = int(SR * 0.05); seg = slice(max(a, b - k), b)
        x = x.copy(); x[seg] *= 0.5 * (1 + np.cos(np.linspace(0, np.pi, seg.stop - seg.start)))
    y = np.concatenate([np.zeros(int(SR * LEAD), np.float32), x[a:b], np.zeros(int(SR * TAIL), np.float32)])
    fi = int(SR * 0.005); y[:fi] *= np.linspace(0, 1, fi)
    return y


def synth(text, steps):
    wav, _ = tts.synthesize(text, voice_style=st, total_steps=steps, speed=SPEED, lang='ko')
    return np.asarray(wav, dtype=np.float32).reshape(-1)


def save(path, y):
    tmp = path + '.part'
    with wave.open(tmp, 'wb') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR); w.writeframes((np.clip(y, -1, 1) * 32767).astype('<i2').tobytes())
    os.replace(tmp, path)  # 반쪽 파일을 패드가 집지 않게


def say(req):
    t = time.monotonic(); save(req['out'], finish(synth(req['text'], 5), True))
    return {'ms': round((time.monotonic() - t) * 1000)}


def pre(req):
    d = req['dir']; os.makedirs(d, exist_ok=True)
    for i, p in enumerate(req['phrases'], 1):
        best = None
        for _ in range(4):
            raw = synth(p, 8); y = finish(raw, False); f = fall_ms(y)
            if best is None or f > best[1]: best = (y, f, raw)
            if f >= 50: break
        save(os.path.join(d, f'{i:02d}.wav'), best[0] if best[1] >= 50 else finish(best[2], True))
    json.dump(req['phrases'], open(os.path.join(d, 'index.json'), 'w'), ensure_ascii=False)
    return {'n': len(req['phrases'])}


synth('준비', 5)  # 첫 합성은 느리다 — 띄우면서 한 번
print(json.dumps({'ok': True, 'ready': True}), flush=True)
for line in sys.stdin:
    try:
        req = json.loads(line)
        out = say(req) if req.get('op') == 'say' else pre(req) if req.get('op') == 'pre' else None
        print(json.dumps({'ok': out is not None, **(out or {'err': 'op'})}, ensure_ascii=False), flush=True)
    except Exception as e:  # noqa: BLE001 — 한 줄 실패가 서버를 죽이지 않게
        print(json.dumps({'ok': False, 'err': str(e)[:300]}, ensure_ascii=False), flush=True)
