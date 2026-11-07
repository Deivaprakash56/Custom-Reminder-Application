"""Original, synthesized background track for the demo (no samples, no third-party audio).
Upbeat 112 BPM in A major: I-V-vi-IV. Writes music.wav (44.1 kHz stereo).
Structure (bars): 0-3 intro | 4 drop | 13 lead in | 33-36 breakdown | 37 re-drop | 41 outro, final chord at 43.
"""
import json
import sys

import numpy as np
from scipy.signal import butter, sosfilt, fftconvolve

SR = 44100
BPM = 112
BEAT = 60 / BPM
BAR = 4 * BEAT
NBARS = 45
TAIL = 4.0
N = int((NBARS * BAR + TAIL) * SR)
rng = np.random.default_rng(7)

def mtof(m): return 440.0 * 2 ** ((m - 69) / 12)
def bt(bar, beat=0.0): return (bar * 4 + beat) * BEAT
def lp(x, f, order=2): return sosfilt(butter(order, f, "low", fs=SR, output="sos"), x)
def hp(x, f, order=2): return sosfilt(butter(order, f, "high", fs=SR, output="sos"), x)
def bp(x, lo, hi, order=2): return sosfilt(butter(order, [lo, hi], "band", fs=SR, output="sos"), x)

def saw(f, n, phase=0.0):
    t = np.arange(n) / SR
    return 2 * ((f * t + phase) % 1.0) - 1

def add(buf, start_s, sig, gain=1.0):
    i = int(start_s * SR)
    if i >= len(buf): return
    j = min(len(buf), i + len(sig))
    buf[i:j] += sig[: j - i] * gain

def env_adsr(n, a, d, s, r_len):
    e = np.ones(n) * s
    na, nd = int(a * SR), int(d * SR)
    na = min(na, n); e[:na] = np.linspace(0, 1, na)
    nd = min(nd, n - na); e[na:na + nd] = np.linspace(1, s, nd)
    nr = min(int(r_len * SR), n)
    e[n - nr:] *= np.linspace(1, 0, nr)
    return e

# chords: I V vi IV in A major (midi)
CHORDS = [[57, 61, 64], [52, 56, 59], [54, 57, 61], [50, 54, 57]]  # A, E, F#m, D
ROOTS = [45, 40, 42, 38]

def chord_at(bar): return bar % 4

# section helpers
def drums_on(bar): return 4 <= bar <= 32 or 37 <= bar <= 42
def full(bar): return drums_on(bar)
def lead_on(bar): return 13 <= bar <= 32 or 37 <= bar <= 42
def breakdown(bar): return 33 <= bar <= 36

L = np.zeros(N); R = np.zeros(N)
rev_send = np.zeros(N)
ST = {}

# ---------------------------------------------------------------- pad (detuned saws, filtered)
pad = np.zeros(N); padR = np.zeros(N)
for bar in range(NBARS):
    if bar >= 44: continue
    ch = CHORDS[chord_at(bar)] if bar < 43 else [57, 61, 64]
    length = BAR + 0.25 if bar < 43 else BAR + TAIL - 0.2
    n = int(length * SR)
    sigL = np.zeros(n); sigR = np.zeros(n)
    for m in ch + [ch[0] + 12]:
        for k, det in enumerate([-0.12, -0.05, 0.0, 0.06, 0.13]):
            f = mtof(m) * 2 ** (det / 12)
            s = saw(f, n, rng.random())
            if k % 2: sigL += s
            else: sigR += s
    e = env_adsr(n, 0.35 if bar else 1.6, 0.4, 0.85, 0.35 if bar < 43 else 2.6)
    g = 0.010 if bar < 4 else 0.012
    if breakdown(bar): g = 0.014
    add(pad, bt(bar), sigL * e, g); add(padR, bt(bar), sigR * e, g)
# filter: intro opens up from dark to bright
cut = np.interp(np.arange(N) / SR, [0, bt(4), bt(33), bt(36), bt(37), bt(45)], [500, 2600, 2600, 900, 2800, 2400])
def sweep_lp(x, cutoffs, block=2048):
    out = np.zeros_like(x); zi = None
    for i in range(0, len(x), block):
        sos = butter(2, cutoffs[i], "low", fs=SR, output="sos")
        if zi is None or zi.shape[0] != sos.shape[0]:
            zi = np.zeros((sos.shape[0], 2))
        out[i:i + block], zi = sosfilt(sos, x[i:i + block], zi=zi)
    return out
pad = sweep_lp(pad, cut); padR = sweep_lp(padR, cut)

# ---------------------------------------------------------------- sidechain envelope from kicks
duck = np.ones(N)
kick_times = [bt(bar, b) for bar in range(NBARS) if drums_on(bar) for b in range(4)]
dn = int(0.32 * SR)
shape = 1 - 0.55 * np.exp(-np.linspace(0, 5, dn))
for t in kick_times:
    i = int(t * SR); j = min(N, i + dn)
    duck[i:j] = np.minimum(duck[i:j], shape[: j - i])

ST["pad"] = (pad * duck, padR * duck)

# ---------------------------------------------------------------- pluck arpeggio (16ths) with ping-pong delay
arp = np.zeros(N)
pattern = [0, 1, 2, 3, 2, 1, 2, 3, 0, 1, 2, 3, 4, 3, 2, 1]
for bar in range(NBARS - 2):
    ch = CHORDS[chord_at(bar)]
    tones = [ch[0] + 12, ch[1] + 12, ch[2] + 12, ch[0] + 24, ch[1] + 24]
    for s16 in range(16):
        if bar < 2 and s16 % 2: continue
        if bar == 42 and s16 > 7: continue
        m = tones[pattern[s16]]
        n = int(0.26 * SR)
        t = np.arange(n) / SR
        f = mtof(m)
        sig = 0.6 * np.sign(np.sin(2 * np.pi * f * t)) * 0.5 + 0.5 * saw(f, n)
        e = np.exp(-t * 18) * (1 - np.exp(-t * 900))
        acc = 1.0 if s16 % 4 == 0 else 0.72
        g = 0.05 * acc
        if bar < 4: g *= 0.55 + 0.45 * bar / 3
        if breakdown(bar): g *= 0.8
        add(arp, bt(bar, s16 * 0.25), sig * e, g)
arp = lp(arp, 3200)
arp_cut = np.interp(np.arange(N) / SR, [0, bt(4), bt(33), bt(36.5), bt(37)], [1200, 4200, 4200, 1500, 4200])
arp = sweep_lp(arp, arp_cut)
d = int(BEAT * 0.75 * SR)
dl = np.zeros(N); dr = np.zeros(N)
dl[d:] += arp[:-d] * 0.38; dr[2 * d:] += arp[:-2 * d] * 0.26
ST["arp"] = (arp * 0.9 + dl, arp * 0.9 + dr)

# ---------------------------------------------------------------- bass (offbeat 8ths, sub + grit)
bass = np.zeros(N)
for bar in range(NBARS):
    if not (full(bar) or bar == 43): continue
    root = ROOTS[chord_at(bar)] if bar < 43 else 33
    if bar == 43:
        n = int(3.5 * SR); t = np.arange(n) / SR; f = mtof(root)
        add(bass, bt(bar), (np.sin(2 * np.pi * f * t) * np.exp(-t * 0.9)), 0.30)
        continue
    for e8 in range(8):
        n = int(BEAT * 0.48 * SR); t = np.arange(n) / SR; f = mtof(root + (12 if e8 % 2 else 0))
        s = np.sin(2 * np.pi * f * t) + 0.25 * np.tanh(3 * saw(f, n))
        e = env_adsr(n, 0.004, 0.08, 0.7, 0.05)
        add(bass, bt(bar, e8 * 0.5), s * e, 0.16 if e8 % 2 else 0.20)
bass = lp(bass, 900)
ST["bass"] = (bass * duck, bass * duck)

# ---------------------------------------------------------------- drums
drums = np.zeros(N); drumsR = np.zeros(N)
kk = np.zeros(N); hats = np.zeros(N); hatsR = np.zeros(N)
def kick():
    n = int(0.42 * SR); t = np.arange(n) / SR
    f = 46 + 110 * np.exp(-t * 28)
    ph = 2 * np.pi * np.cumsum(f) / SR
    s = np.sin(ph) * np.exp(-t * 7.5)
    s[:int(0.004 * SR)] += rng.normal(0, 0.4, int(0.004 * SR))
    return np.tanh(s * 1.6)
def clap():
    n = int(0.35 * SR); t = np.arange(n) / SR
    noise = bp(rng.normal(0, 1, n), 900, 3500)
    e = np.zeros(n)
    for k, o in enumerate([0, 0.011, 0.022]):
        i = int(o * SR); e[i:] = np.maximum(e[i:], np.exp(-(t[: n - i]) * (60 if k < 2 else 16)))
    return noise * e
def hat(open_=False):
    n = int((0.28 if open_ else 0.06) * SR); t = np.arange(n) / SR
    return hp(rng.normal(0, 1, n), 7500) * np.exp(-t * (11 if open_ else 70))
def crash():
    n = int(2.6 * SR); t = np.arange(n) / SR
    return hp(rng.normal(0, 1, n), 4500) * np.exp(-t * 1.6)
K, C = kick(), clap()
for bar in range(NBARS):
    if drums_on(bar):
        for b in range(4):
            add(kk, bt(bar, b), K, 1.0)
            hh = hat(open_=True) if b % 2 else hat()
            add(hats, bt(bar, b + 0.5), hat(open_=(b % 2 == 1)), 1.0); add(hatsR, bt(bar, b + 0.5), hat(open_=(b % 2 == 1)), 1.2)
            if bar >= 7:
                add(hats, bt(bar, b + 0.25), hat(), 0.45); add(hatsR, bt(bar, b + 0.75), hat(), 0.45)
        for b in (1, 3):
            add(drums, bt(bar, b), C, 0.20); add(drumsR, bt(bar, b), C, 0.20)
        if bar in (12, 20, 28, 40):  # small fill on the last beat
            for s16 in range(4):
                add(drums, bt(bar, 3 + s16 * 0.25), C, 0.08 + 0.03 * s16); add(drumsR, bt(bar, 3 + s16 * 0.25), C, 0.08 + 0.03 * s16)
    if breakdown(bar) and bar >= 35:
        # building kick/clap roll into the re-drop
        step = 1.0 if bar == 35 else 0.5 if bar == 36 else 1
        b = 0.0
        while b < 4:
            g = 0.18 + 0.25 * ((bar - 35) * 4 + b) / 8
            add(drums, bt(bar, b), C, g * 0.6); add(drumsR, bt(bar, b), C, g * 0.6)
            b += step if not (bar == 36 and b >= 2) else 0.25
for bar in (4, 13, 21, 29, 37, 41):
    cr = crash(); add(drums, bt(bar), cr, 0.12); add(drumsR, bt(bar), cr, 0.12)
# final hit
add(kk, bt(43), K, 1.2)
cr = crash(); add(drums, bt(43), cr, 0.16); add(drumsR, bt(43), cr, 0.16)
ST["kick"] = (kk, kk)
ST["hats"] = (hats, hatsR)
ST["perc"] = (drums, drumsR)

# ---------------------------------------------------------------- risers (noise sweep) before drops
def riser(length_s):
    n = int(length_s * SR); t = np.arange(n) / SR
    x = rng.normal(0, 1, n)
    out = np.zeros(n); blk = 1024
    for i in range(0, n, blk):
        u = i / n; fc = 400 + 7000 * u ** 2
        out[i:i + blk] = bp(x[i:i + blk + 0], fc * 0.7, min(fc * 1.4, 18000), 1)
    return out * (t / length_s) ** 2.2
RZ = np.zeros(N)
for bar_start, bars in ((3, 1), (36, 1), (12, 0.5), (40, 0.5)):
    rz = riser(bars * BAR)
    add(RZ, bt(bar_start + (1 - bars)), rz, 1.0)

ST["riser"] = (RZ, RZ)

# ---------------------------------------------------------------- bell lead (FM)
MOTIF = [  # (beat, midi, beats) for a 4-bar phrase over A E F#m D
    (0, 76, 1), (1, 73, 0.5), (1.5, 76, 1), (2.5, 81, 1.5),
    (4, 80, 1), (5, 78, 0.5), (5.5, 76, 1), (6.5, 71, 1.5),
    (8, 73, 1), (9, 76, 0.5), (9.5, 78, 1), (10.5, 81, 1.5),
    (12, 78, 1), (13, 76, 0.5), (13.5, 74, 1), (14.5, 76, 1.5),
]
lead = np.zeros(N)
for bar in range(NBARS):
    if not lead_on(bar) or bar % 4 != (13 % 4): continue
    for beat, m, ln in MOTIF:
        start = bt(bar, beat)
        if start >= bt(43): continue
        n = int((ln * BEAT + 0.9) * SR); t = np.arange(n) / SR; f = mtof(m)
        idx = 2.2 * np.exp(-t * 6)
        s = np.sin(2 * np.pi * f * t + idx * np.sin(2 * np.pi * f * 3.5 * t)) * np.exp(-t * 2.8)
        s += 0.35 * np.sin(2 * np.pi * f * 2 * t) * np.exp(-t * 5)
        add(lead, start, s * (1 - np.exp(-t * 400)), 0.075)
ST["lead"] = (lead * 0.85, lead)

# ---------------------------------------------------------------- balance stems to target levels (dB, measured in the main groove)
TARGET = {"kick": -13, "bass": -17, "pad": -19, "arp": -19.5, "lead": -18, "hats": -24.5, "perc": -21, "riser": -24}
SEND = {"pad": 0.35, "arp": 0.3, "lead": 0.6, "perc": 0.12, "riser": 0.4, "hats": 0.05, "kick": 0.0, "bass": 0.0}
a, b = int(bt(13) * SR), int(bt(33) * SR)
for k, (sl, sr_) in ST.items():
    seg = (sl + sr_)[a:b] / 2 if k != "riser" else (sl + sr_) / 2
    seg = seg[np.abs(seg) > 1e-5] if k == "riser" else seg
    rms = np.sqrt(np.mean(seg ** 2)) + 1e-12
    g = 10 ** (TARGET[k] / 20) / rms
    L += sl * g; R += sr_ * g; rev_send += (sl + sr_) * 0.5 * g * SEND[k]
    print(f"{k:6s} gain {20*np.log10(g):6.1f} dB")

# ---------------------------------------------------------------- reverb
ir_n = int(2.4 * SR); ti = np.arange(ir_n) / SR
irL = rng.normal(0, 1, ir_n) * np.exp(-ti * 2.6); irR = rng.normal(0, 1, ir_n) * np.exp(-ti * 2.6)
irL = lp(irL, 6000); irR = lp(irR, 6000)
irL /= np.sqrt(np.sum(irL ** 2)); irR /= np.sqrt(np.sum(irR ** 2))
rs = hp(rev_send, 250)
L += fftconvolve(rs, irL)[:N] * 0.55; R += fftconvolve(rs, irR)[:N] * 0.55

# ---------------------------------------------------------------- master
mix = np.stack([L, R], axis=1)
mix = hp(mix.T, 28).T
fade_n = int(3.0 * SR)
mix[-fade_n:] *= np.linspace(1, 0, fade_n)[:, None] ** 1.5
mix[: int(0.02 * SR)] *= np.linspace(0, 1, int(0.02 * SR))[:, None]
peak = np.max(np.abs(mix)); mix = mix / peak * 1.25
mix = np.tanh(mix) * 0.89  # gentle saturation / limiting
out = sys.argv[1] if len(sys.argv) > 1 else "music.wav"
import wave
with wave.open(out, "wb") as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
    w.writeframes((mix * 32767).astype("<i2").tobytes())
print("wrote", out, f"{N / SR:.1f}s")
