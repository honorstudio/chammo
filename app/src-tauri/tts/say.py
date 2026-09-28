"""Chammo 의 Supertonic 목소리 — say.py <출력.wav> <목소리 M1…F5> <할 말>
모델(supertonic-3, 약 385MB)은 이 폴더 model/ 에 받는다. 한글이 있으면 한국어, 없으면 영어로 읽는다."""
import os, re, sys, wave
import numpy as np
from supertonic import TTS

out, voice, text = sys.argv[1], sys.argv[2], " ".join(sys.argv[3:])
here = os.path.dirname(os.path.abspath(__file__))
tts = TTS(model="supertonic-3", model_dir=os.path.join(here, "model"), auto_download=True)
lang = "ko" if re.search(r"[가-힣]", text) else "en"
wav, _ = tts.synthesize(text, voice_style=tts.get_voice_style(voice_name=voice), lang=lang)
pcm = (np.clip(np.asarray(wav, dtype=np.float32).reshape(-1), -1, 1) * 32767).astype("<i2")
with wave.open(out, "wb") as w:
    w.setnchannels(1); w.setsampwidth(2); w.setframerate(tts.sample_rate); w.writeframes(pcm.tobytes())
