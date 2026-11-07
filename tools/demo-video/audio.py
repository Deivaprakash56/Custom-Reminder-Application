"""Mixes the music with synthesized UI sound effects at the editor's cue times -> mix.wav"""
import json
import os
import wave

import numpy as np
from scipy.signal import butter, sosfilt

HERE = os.path.dirname(os.path.abspath(__file__))
SR = 44100
rng = np.random.default_rng(11)

def read_wav(p):
    w = wave.open(p); x = np.frombuffer(w.readframes(w.getnframes()), "<i2").reshape(-1, 2).astype(np.float64) / 32768
    return x
def bp(x, lo, hi, o=2): return sosfilt(butter(o, [lo, hi], "band", fs=SR, output="sos"), x)

def click():
    n = int(0.05 * SR); t = np.arange(n) / SR
    s = np.sin(2 * np.pi * 2300 * t) * np.exp(-t * 160) * 0.6 + bp(rng.normal(0, 1, n), 2000, 7000) * np.exp(-t * 400) * 0.5
    return np.stack([s, s], 1)
def drop():
    n = int(0.16 * SR); t = np.arange(n) / SR
    f = 220 * np.exp(-t * 8)
    s = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 30)
    return np.stack([s, s], 1) * 0.9 + np.pad(click(), ((0, n - len(click())), (0, 0))) * 0.5
def whoosh(length=0.7):
    n = int(length * SR); t = np.arange(n) / SR; u = t / length
    x = rng.normal(0, 1, n); out = np.zeros(n); blk = 512
    for i in range(0, n, blk):
        fc = 300 + 2600 * np.sin(np.pi * min(1, i / n)) ** 1.5
        out[i:i + blk] = bp(x[i:i + blk], fc * 0.6, fc * 1.6, 1)
    e = np.sin(np.pi * u) ** 2
    pan = u
    return np.stack([out * e * (1 - pan * 0.7), out * e * (0.3 + pan * 0.7)], 1)
def shimmer():
    n = int(1.8 * SR); t = np.arange(n) / SR; s = np.zeros(n)
    for i, f in enumerate([1760, 2217, 2637, 3520]):
        d = int(i * 0.06 * SR); tt = t[: n - d]
        s[d:] += np.sin(2 * np.pi * f * tt + 1.2 * np.exp(-tt * 5) * np.sin(2 * np.pi * f * 2.01 * tt)) * np.exp(-tt * 3.2) * 0.3
    return np.stack([s * 0.8, s], 1)

def main():
    cues = json.load(open(os.path.join(HERE, "cues.json")))
    dur = cues["duration"]
    music = read_wav(os.path.join(HERE, "music.wav"))
    N = int(dur * SR)
    music = music[:N] if len(music) >= N else np.pad(music, ((0, N - len(music)), (0, 0)))
    fx = np.zeros((N, 2))
    gains = {"click": 0.10, "drop": 0.12, "whoosh": 0.10, "shimmer": 0.09}
    lib = {"click": click(), "drop": drop(), "whoosh": whoosh(), "shimmer": shimmer()}
    for c in cues["cues"]:
        s = lib[c["kind"]]; off = 0.42 if c["kind"] == "whoosh" else 0.0
        i = int((c["t"] - off) * SR)
        if i < 0 or i >= N: continue
        j = min(N, i + len(s)); fx[i:j] += s[: j - i] * gains[c["kind"]]
    mix = music * 0.92 + fx
    fo = int(1.4 * SR); mix[-fo:] *= np.linspace(1, 0, fo)[:, None]
    peak = np.max(np.abs(mix))
    if peak > 0.97: mix *= 0.97 / peak
    with wave.open(os.path.join(HERE, "mix.wav"), "wb") as w:
        w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
        w.writeframes((mix * 32767).astype("<i2").tobytes())
    print("mix.wav", dur)

if __name__ == "__main__":
    main()
