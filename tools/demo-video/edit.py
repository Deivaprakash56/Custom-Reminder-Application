"""Edits the captured frames into the final product film.
Camera zooms/pans, a rendered cursor with click ripples, captions, title cards, a phone mock-up
and crossfades, timed to the music bars. Usage: python3 edit.py [--preview START END] [--fps N]
"""
import bisect
import json
import math
import os
import subprocess
import sys
from functools import lru_cache
from multiprocessing import Pool

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
CAP = os.path.join(HERE, "cap")
ICON = os.path.join(HERE, "..", "..", "docs", "icons", "icon-512.png")
FONT_DIR = "/usr/share/fonts/opentype/inter/"
W, H = 1920, 1080
FPS = 60
BAR = 60 / 112 * 4
XF = 0.5  # crossfade length (s)
NAME = "Nudge"
TAGLINE = "Remember everything. Effortlessly."
URL = "deivaprakash56.github.io/Custom-Reminder-Application"

meta = json.load(open(os.path.join(CAP, "events.json")))
VW, VH, DSF, CH = meta["VW"], meta["VH"], meta["DSF"], meta["CH"]
EV = meta["events"]
FR = {s: json.load(open(os.path.join(CAP, s, "frames.json"))) for s in ("desktop", "mobile")}
FT = {s: [f["t"] for f in FR[s]] for s in FR}

CLIPS = {}
for e in EV:
    if e["type"] == "clip": CLIPS[e["name"]] = [e["s"], e["t"], None]
    if e["type"] == "clipend": CLIPS[e["name"]][2] = e["t"]

SEGS = [("intro", 4), ("today", 3), ("assistant", 6), ("alert", 4), ("calendar", 3), ("board", 4), ("habits", 3),
        ("focus", 3), ("insights", 3), ("vault", 4), ("devices", 4), ("outro", 4)]
TL = []
acc = 0.0
for name, bars in SEGS:
    TL.append((name, acc, acc + bars * BAR)); acc += bars * BAR
END = acc + 1.6
DURATION = END

def font(name, size): return ImageFont.truetype(FONT_DIR + name, size)

# ------------------------------------------------------------------ easing
def clamp(x, a=0.0, b=1.0): return max(a, min(b, x))
def ease_io(u): u = clamp(u); return 4 * u ** 3 if u < 0.5 else 1 - (-2 * u + 2) ** 3 / 2
def ease_out(u): u = clamp(u); return 1 - (1 - u) ** 3
def ease_back(u, s=1.6): u = clamp(u); return 1 + (s + 1) * (u - 1) ** 3 + s * (u - 1) ** 2

# ------------------------------------------------------------------ static assets
def make_bg():
    bw, bh = int(W * 1.1), int(H * 1.1)
    y, x = np.mgrid[0:bh, 0:bw].astype(np.float32)
    base = np.zeros((bh, bw, 3), np.float32)
    top = np.array([24, 22, 64]); bot = np.array([8, 10, 24])
    g = (x / bw * 0.35 + y / bh * 0.65)[..., None]
    base[:] = top * (1 - g) + bot * g
    def glow(cx, cy, r, col, a):
        d = np.sqrt((x - cx) ** 2 + (y - cy) ** 2) / r
        return (np.exp(-d ** 2) * a)[..., None] * np.array(col, np.float32)
    base += glow(bw * 0.18, bh * 0.05, bw * 0.38, (99, 91, 255), 0.55)
    base += glow(bw * 0.92, bh * 0.95, bw * 0.35, (219, 39, 119), 0.30)
    base += glow(bw * 0.85, bh * 0.08, bw * 0.25, (14, 165, 233), 0.18)
    noise = np.random.default_rng(3).normal(0, 1.6, (bh, bw, 1))
    return Image.fromarray(np.clip(base + noise, 0, 255).astype(np.uint8))
BG = make_bg()
def bg_at(t):
    ox = int((W * 0.05) + math.sin(t * 0.21) * W * 0.04); oy = int((H * 0.05) + math.cos(t * 0.17) * H * 0.04)
    return BG.crop((ox, oy, ox + W, oy + H))

def make_chrome():
    s = DSF; w, h = VW * s, CH * s
    im = Image.new("RGB", (w, h), (238, 240, 245))
    d = ImageDraw.Draw(im)
    d.line([(0, h - 1), (w, h - 1)], fill=(214, 218, 226), width=2)
    for i, col in enumerate([(255, 95, 87), (254, 188, 46), (40, 200, 64)]):
        cx, cy, r = (22 + i * 20) * s, h // 2, 6 * s
        d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=col)
    pw, ph = 560 * s, 26 * s
    x0 = (w - pw) // 2; y0 = (h - ph) // 2
    d.rounded_rectangle([x0, y0, x0 + pw, y0 + ph], radius=8 * s, fill=(255, 255, 255), outline=(226, 229, 236), width=2)
    f = font("Inter-Medium.otf", 13 * s)
    tw = d.textlength(URL, font=f)
    lx = x0 + (pw - tw) / 2 + 8 * s
    # padlock
    d.rounded_rectangle([lx - 18 * s, y0 + 11 * s, lx - 9 * s, y0 + 19 * s], radius=2 * s, fill=(120, 126, 140))
    d.arc([lx - 16.5 * s, y0 + 6 * s, lx - 10.5 * s, y0 + 14 * s], 180, 360, fill=(120, 126, 140), width=int(1.6 * s))
    d.text((lx, y0 + ph / 2), URL, font=f, fill=(84, 90, 104), anchor="lm")
    return im
CHROME = make_chrome()

def make_shadow():
    sc = 0.25; pad = 80
    w, h = int(VW * sc), int((VH + CH) * sc)
    im = Image.new("L", (w + 2 * pad, h + 2 * pad), 0)
    ImageDraw.Draw(im).rounded_rectangle([pad, pad + 10, pad + w, pad + h + 10], radius=int(14 * sc), fill=180)
    return im.filter(ImageFilter.GaussianBlur(22)), pad / sc
SHADOW, SHPAD = make_shadow()

def make_cursor(hgt=160):
    s = hgt / 24
    pts = [(1, 1), (1, 19.5), (5.6, 15.2), (8.6, 22), (11.6, 20.8), (8.7, 14.2), (15, 14.2)]
    pts = [(x * s, y * s) for x, y in pts]
    im = Image.new("RGBA", (int(17 * s), int(24 * s)), (0, 0, 0, 0))
    sh = Image.new("RGBA", im.size, (0, 0, 0, 0))
    ImageDraw.Draw(sh).polygon([(x + 0.8 * s, y + 1.2 * s) for x, y in pts], fill=(0, 0, 0, 110))
    sh = sh.filter(ImageFilter.GaussianBlur(1.2 * s))
    d = ImageDraw.Draw(im)
    d.polygon(pts, fill=(255, 255, 255, 255))
    inner = [(1 + 1.25, 1 + 2.9), (1 + 1.25, 19.5 - 2.4), (5.9, 13.3), (9.3, 20.4), (10.2, 20.0), (6.9, 12.9), (12.2, 12.9)]
    d.polygon([(x * s, y * s) for x, y in inner], fill=(17, 17, 22, 255))
    return Image.alpha_composite(sh, im)
CURSOR = make_cursor()

ICON_IM = Image.open(ICON).convert("RGBA")

@lru_cache(maxsize=64)
def text_sprite(text, fname, size, color=(255, 255, 255), tracking=0):
    f = font(fname, size)
    d = ImageDraw.Draw(Image.new("RGBA", (10, 10)))
    bbox = d.textbbox((0, 0), text, font=f)
    w = bbox[2] - bbox[0] + 20 + int(tracking * len(text)); h = int(size * 1.35)
    im = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    dd = ImageDraw.Draw(im)
    if tracking:
        x = 10
        for ch in text:
            dd.text((x, h / 2), ch, font=f, fill=color + (255,), anchor="lm"); x += d.textlength(ch, font=f) + tracking
    else:
        dd.text((10 - bbox[0], h / 2), text, font=f, fill=color + (255,), anchor="lm")
    return im

def comp(dst, im, x, y):
    """alpha_composite that tolerates sprites hanging off the canvas."""
    x, y = int(round(x)), int(round(y))
    l, t = max(0, -x), max(0, -y)
    r, b = min(im.width, dst.width - x), min(im.height, dst.height - y)
    if r <= l or b <= t: return
    if (l, t, r, b) != (0, 0, im.width, im.height): im = im.crop((l, t, r, b))
    dst.alpha_composite(im, (x + l, y + t))

def paste_alpha(dst, im, x, y, alpha=1.0, scale=1.0):
    if alpha <= 0.003: return
    if scale != 1.0:
        im = im.resize((max(1, int(im.width * scale)), max(1, int(im.height * scale))), Image.BICUBIC)
    if alpha < 0.999:
        a = im.getchannel("A").point(lambda v: int(v * alpha)); im = im.copy(); im.putalpha(a)
    comp(dst, im, x, y)

def pill(text, fname="Inter-SemiBold.otf", size=26, fg=(236, 238, 255), bg=(255, 255, 255, 30), border=(255, 255, 255, 60)):
    t = text_sprite(text, fname, size, fg)
    w, h = t.width + 30, int(size * 2.0)
    im = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    ImageDraw.Draw(im).rounded_rectangle([0, 0, w - 1, h - 1], radius=h // 2, fill=bg, outline=border, width=2)
    im.alpha_composite(t, (15, (h - t.height) // 2))
    return im

# ------------------------------------------------------------------ source frames
@lru_cache(maxsize=24)
def load_frame(stream, idx):
    return Image.open(os.path.join(CAP, stream, FR[stream][idx]["file"])).convert("RGB")
def frame_at(stream, t):
    i = max(0, bisect.bisect_right(FT[stream], t) - 1)
    return load_frame(stream, i)

@lru_cache(maxsize=4)
def window_image(idx):
    fr = load_frame("desktop", idx)
    im = Image.new("RGB", (VW * DSF, (VH + CH) * DSF))
    im.paste(CHROME, (0, 0)); im.paste(fr, (0, CH * DSF))
    return im

# ------------------------------------------------------------------ cues per clip
def clip_events(name):
    s, t0, t1 = CLIPS[name]
    return s, t0, t1, [e for e in EV if t0 - 0.001 <= e["t"] <= t1 + 0.001]

class Track:
    """Camera keyframes: each cue eases from the current value to its target."""
    def __init__(self, cues):
        self.segs = []  # (t, dur, from, to)
        cur = None
        for e in cues:
            tgt = (e["x"], e["y"], math.log(e["w"]))
            frm = tgt if cur is None else self.value(e["t"])
            self.segs.append((e["t"], max(e["dur"], 1e-3), frm, tgt)); cur = tgt
    def value(self, t):
        if not self.segs: return (VW / 2, CH + VH / 2, math.log(VW))
        i = max(0, bisect.bisect_right([s[0] for s in self.segs], t) - 1)
        t0, d, a, b = self.segs[i]
        u = ease_io((t - t0) / d) if t >= t0 else 0.0
        return tuple(a[k] + (b[k] - a[k]) * u for k in range(3))

CLIPDATA = {}
for name, (s, t0, t1) in CLIPS.items():
    _, _, _, evs = clip_events(name)
    camev = [e for e in evs if e["type"] == "cam"]
    if name == "alert":
        last_click = [e for e in evs if e["type"] == "click"][-1]
        ov = camev[0]
        camev = [e for e in camev if e["t"] < last_click["t"]] + [dict(ov, t=last_click["t"] + 0.35, dur=1.1 * 2.5)]
    cams = Track(camev)
    # cursor samples from the whole stream (cursor keeps its position between clips)
    CLIPDATA[name] = dict(s=s, t0=t0, t1=t1, cam=cams, evs=evs)
CUR = {s: sorted([(e["t"], e["x"], e["y"]) for e in EV if e["type"] == "cur" and e.get("s") == s]) for s in ("desktop", "mobile")}
CURT = {s: [c[0] for c in CUR[s]] for s in CUR}
VIS = sorted([(e["t"], e["type"] == "curshow") for e in EV if e["type"] in ("curshow", "curhide")])
CLICKS = [(e["t"], e["x"], e["y"]) for e in EV if e["type"] == "click"]
PRESS = sorted([(e["t"], e["type"] == "press") for e in EV if e["type"] in ("press", "release")])
TAPS = [(e["t"], e["x"], e["y"]) for e in EV if e["type"] == "tap"]

def cursor_at(t):
    c = CUR["desktop"]; i = bisect.bisect_right(CURT["desktop"], t) - 1
    if i < 0: return None
    if i + 1 < len(c) and c[i + 1][0] - c[i][0] < 0.2:
        a, b = c[i], c[i + 1]; u = (t - a[0]) / (b[0] - a[0])
        return (a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u)
    return c[i][1:]
def cursor_visible(t):
    v = False
    for tt, on in VIS:
        if tt <= t: v = on
    return v
def pressed(t):
    p = False
    for tt, on in PRESS:
        if tt <= t: p = on
    return p

def caption_state(evs, tc):
    """Returns (title, sub, t_in, t_out) of the caption active at tc."""
    cur = None
    for e in evs:
        if e["t"] > tc + 1.0: break
        if e["type"] == "cap": cur = [e["title"], e["sub"], e["t"], None]
        if e["type"] == "capoff" and cur: cur[3] = e["t"]
    return cur

# ------------------------------------------------------------------ renderers
def draw_caption(img, cap, tc, speed, layout="top"):
    if not cap: return
    title, sub, tin, tout = cap
    def alpha_y(delay):
        u = (tc - tin) / speed - delay
        a = ease_out(u / 0.55); dy = (1 - ease_out(u / 0.7)) * 26
        if tout is not None:
            v = (tc - tout) / speed
            if v > 0: a *= 1 - ease_out(v / 0.35); dy -= ease_out(v / 0.35) * 10
        return a, dy
    ts = text_sprite(title, "InterDisplay-Bold.otf", 72)
    ss = text_sprite(sub, "Inter-Medium.otf", 31, (200, 205, 230))
    a1, d1 = alpha_y(0.0); a2, d2 = alpha_y(0.12)
    if layout == "top":
        paste_alpha(img, ts, (W - ts.width) / 2, 64 + d1, a1)
        paste_alpha(img, ss, (W - ss.width) / 2, 160 + d2, a2)
    else:
        paste_alpha(img, ts, 150, 400 + d1, a1)
        paste_alpha(img, ss, 152, 500 + d2, a2)

def render_desktop(name, u, slot, enter=False):
    cd = CLIPDATA[name]; t0, t1 = cd["t0"], cd["t1"]
    speed = (t1 - t0) / slot
    tc = clamp(t0 + u * speed, t0, t1)
    cx, cy, lw = cd["cam"].value(tc); cw = math.exp(lw); chh = cw * 9 / 16
    # keep zoomed-in shots inside the window (no background peeking past an edge)
    if cw < VW: cx = clamp(cx, cw / 2, VW - cw / 2)
    if chh < VH + CH: cy = clamp(cy, chh / 2 + CH * 0.0, VH + CH - chh / 2)
    k = W / cw  # output px per css px
    dy_enter = 0.0; a_enter = 1.0
    if enter:
        e = ease_out(u / 1.1); dy_enter = (1 - e) * 700; a_enter = clamp(u / 0.35)
    img = bg_at(u + (TL_START.get(name, 0))).convert("RGBA")
    # window rectangle in output coordinates
    wx0 = (0 - (cx - cw / 2)) * k; wy0 = (0 - (cy - chh / 2)) * k + dy_enter
    ww, wh = VW * k, (VH + CH) * k
    if k < 1.25 * W / VW:  # shadow only matters when the window floats
        shadow = SHADOW.resize((int((VW + 2 * SHPAD) * k), int((VH + CH + 2 * SHPAD) * k)), Image.BILINEAR)
        black = Image.new("RGBA", shadow.size, (2, 4, 18, 255)); black.putalpha(shadow.point(lambda v: int(v * 0.85 * a_enter)))
        comp(img, black, wx0 - SHPAD * k, wy0 - SHPAD * k + 18 * k)
    # crop the visible part of the window and scale it
    fi = max(0, bisect.bisect_right(FT["desktop"], tc) - 1)
    win = window_image(fi)
    ox0, oy0 = max(0, wx0), max(0, wy0); ox1, oy1 = min(W, wx0 + ww), min(H, wy0 + wh)
    if ox1 > ox0 and oy1 > oy0:
        s2o = k / DSF
        box = ((ox0 - wx0) / s2o, (oy0 - wy0) / s2o, (ox1 - wx0) / s2o, (oy1 - wy0) / s2o)
        tw, th = int(round(ox1)) - int(round(ox0)), int(round(oy1)) - int(round(oy0))
        part = win.resize((tw, th), Image.LANCZOS if s2o < 0.75 else Image.BICUBIC, box=box)
        mask = Image.new("L", (tw, th), 0)
        r = 14 * k
        ImageDraw.Draw(mask).rounded_rectangle([wx0 - int(round(ox0)), wy0 - int(round(oy0)), wx0 - int(round(ox0)) + ww - 1, wy0 - int(round(oy0)) + wh - 1], radius=r, fill=int(255 * a_enter))
        img.paste(part, (int(round(ox0)), int(round(oy0))), mask)
    # cursor + click ripples
    def to_out(x, y): return ((x - (cx - cw / 2)) * k, (y - (cy - chh / 2)) * k + dy_enter)
    for (tt, x, y) in CLICKS:
        v = (tc - tt) / speed
        if 0 <= v < 0.5:
            px, py = to_out(x, y); rr = (8 + 34 * ease_out(v / 0.5)) * min(k, 2.4) / 1.4
            ring = Image.new("RGBA", (int(rr * 2 + 8), int(rr * 2 + 8)), (0, 0, 0, 0))
            ImageDraw.Draw(ring).ellipse([4, 4, 4 + rr * 2, 4 + rr * 2], outline=(99, 102, 241, int(230 * (1 - v / 0.5))), width=max(2, int(3 * min(k, 2.4) / 1.4)), fill=(99, 102, 241, int(60 * (1 - v / 0.5))))
            comp(img, ring, px - rr - 4, py - rr - 4)
    p = cursor_at(tc)
    if p and cursor_visible(tc):
        px, py = to_out(*p)
        sc = min(30 * k / 1.0, 64) / CURSOR.height
        recent = [tc - tt for tt, _, _ in CLICKS if 0 <= tc - tt < 0.18]
        if recent or pressed(tc): sc *= 0.86
        cur = CURSOR.resize((max(1, int(CURSOR.width * sc)), max(1, int(CURSOR.height * sc))), Image.BICUBIC)
        if -100 < px < W + 100 and -100 < py < H + 100:
            comp(img, cur, px - sc * 6.7, py - sc * 6.7)
    draw_caption(img, caption_state(cd["evs"], tc), tc, speed)
    return img

def phone_frame(screen, k):
    """Draw a phone around a screen image (k = output px per css px)."""
    sw, sh = screen.size
    bez = int(13 * k); rad = int(50 * k); scale = k
    w, h = sw + 2 * bez, sh + 2 * bez
    im = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.rounded_rectangle([0, 0, w - 1, h - 1], radius=rad + bez, fill=(18, 19, 24, 255), outline=(70, 74, 86, 255), width=max(2, int(3 * scale)))
    mask = Image.new("L", (sw, sh), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, sw - 1, sh - 1], radius=rad, fill=255)
    im.paste(screen, (bez, bez), mask)
    # dynamic island
    iw, ih = int(122 * scale), int(36 * scale)
    d.rounded_rectangle([w / 2 - iw / 2, bez + 11 * scale, w / 2 + iw / 2, bez + 11 * scale + ih], radius=ih // 2, fill=(0, 0, 0, 255))
    return im

def render_devices(u, slot):
    cd = CLIPDATA["devices"]; t0, t1 = cd["t0"], cd["t1"]
    speed = (t1 - t0) / slot
    tc = clamp(t0 + u * speed, t0, t1)
    img = bg_at(u + TL_START["devices"]).convert("RGBA")
    fr = frame_at("mobile", tc)
    push = 1.0 + 0.05 * ease_io(u / slot)
    ph_h = 852 * push
    sc_px = ph_h / fr.height
    screen = fr.resize((int(fr.width * sc_px), int(fr.height * sc_px)), Image.LANCZOS)
    # taps
    vw = fr.width / 3
    for tt, x, y in TAPS:
        v = (tc - tt) / speed
        if 0 <= v < 0.55:
            k = screen.width / vw; px, py = x * k, y * k; rr = (14 + 22 * ease_out(v / 0.55)) * k
            ov = Image.new("RGBA", screen.size, (0, 0, 0, 0))
            ImageDraw.Draw(ov).ellipse([px - rr, py - rr, px + rr, py + rr], fill=(255, 255, 255, int(110 * (1 - v / 0.55))))
            screen = Image.alpha_composite(screen.convert("RGBA"), ov)
    kk = screen.width / vw
    bar_h = int(50 * kk)
    bgc = screen.convert("RGB").getpixel((screen.width // 2, 4))
    full = Image.new("RGB", (screen.width, screen.height + bar_h), bgc)
    full.paste(screen.convert("RGB"), (0, bar_h))
    dd = ImageDraw.Draw(full)
    dd.text((34 * kk, bar_h * 0.58), "10:30", font=font("Inter-SemiBold.otf", int(16 * kk)), fill=(240, 242, 250), anchor="lm")
    bx = screen.width - 34 * kk; by = bar_h * 0.58
    dd.rounded_rectangle([bx - 25 * kk, by - 6 * kk, bx, by + 6 * kk], radius=3 * kk, outline=(240, 242, 250), width=max(1, int(1.4 * kk)))
    dd.rounded_rectangle([bx - 23 * kk, by - 4 * kk, bx - 6 * kk, by + 4 * kk], radius=2 * kk, fill=(240, 242, 250))
    for j in range(4):
        hh = (4 + j * 2.6) * kk; xx = bx - 58 * kk + j * 5 * kk
        dd.rounded_rectangle([xx, by + 6 * kk - hh, xx + 3.2 * kk, by + 6 * kk], radius=1, fill=(240, 242, 250))
    screen = full.resize((screen.width, screen.height), Image.LANCZOS) if False else full
    phone = phone_frame(screen, kk)
    e = ease_out(u / 0.9)
    bob = math.sin(u * 1.4) * 6
    x = 1080 + (1 - e) * 260 + (1 - push) * 0; y = (H - phone.height) / 2 + bob + (1 - e) * 40
    # soft shadow under the phone
    shm = Image.new("L", (phone.width + 160, phone.height + 160), 0)
    ImageDraw.Draw(shm).rounded_rectangle([80, 100, 80 + phone.width, 100 + phone.height], radius=90, fill=150)
    shm = shm.resize((shm.width // 4, shm.height // 4)).filter(ImageFilter.GaussianBlur(12)).resize(shm.size, Image.BILINEAR)
    sh = Image.new("RGBA", shm.size, (0, 0, 10, 255)); sh.putalpha(shm.point(lambda v: int(v * e)))
    comp(img, sh, x - 80, y - 80)
    paste_alpha(img, phone, x, y, clamp(u / 0.3))
    cap = caption_state(cd["evs"], tc) or ["On every device.", "Install it like an app. It even works offline.", t0, None]
    draw_caption(img, cap, max(tc, t0 + (u - 0.15) * speed), speed, layout="left")
    # platform pills
    a = ease_out((u - 0.7) / 0.6)
    xx = 152
    for label in ("Phone", "Tablet", "Desktop", "Offline-ready"):
        pl = pill(label, size=24)
        paste_alpha(img, pl, xx, 600 + (1 - a) * 16, a); xx += pl.width + 14
    return img

def logo_block(img, u, cx, cy, scale=1.0, alpha=1.0, pulse=0.0):
    s = ease_back(u / 0.7) if u < 0.7 else 1.0
    a = clamp(u / 0.3) * alpha
    size = int(220 * scale * (0.55 + 0.45 * s) * (1 + pulse))
    ic = ICON_IM.resize((size, size), Image.LANCZOS)
    # glow
    gl = Image.new("RGBA", (size * 2, size * 2), (0, 0, 0, 0))
    ImageDraw.Draw(gl).ellipse([size * 0.35, size * 0.35, size * 1.65, size * 1.65], fill=(110, 100, 255, int(150 * a)))
    gl = gl.filter(ImageFilter.GaussianBlur(size * 0.22))
    comp(img, gl, cx - size, cy - size)
    paste_alpha(img, ic, cx - size / 2, cy - size / 2, a)

def render_intro(u):
    img = bg_at(u).convert("RGBA")
    out_u = (u - (4 * BAR - 0.9)) / 0.9  # leave
    fade = 1 - ease_io(out_u)
    lift = ease_io(out_u) * -60
    logo_block(img, u - 0.25, W / 2, 400 + lift, 1.0, fade)
    t = text_sprite(NAME, "InterDisplay-Bold.otf", 150, tracking=-3)
    a = ease_out((u - 0.95) / 0.6) * fade
    paste_alpha(img, t, (W - t.width) / 2, 540 + (1 - ease_out((u - 0.95) / 0.8)) * 30 + lift, a)
    tg = text_sprite(TAGLINE, "Inter-Medium.otf", 40, (205, 210, 240))
    a2 = ease_out((u - 1.9) / 0.7) * fade
    paste_alpha(img, tg, (W - tg.width) / 2, 735 + (1 - ease_out((u - 1.9) / 0.8)) * 20 + lift, a2)
    feats = ["Voice assistant", "Smart reminders", "Calendar", "Habits", "Focus timer"]
    pls = [pill(f, size=24) for f in feats]
    tot = sum(p.width for p in pls) + 14 * (len(pls) - 1)
    x = (W - tot) / 2
    for i, p in enumerate(pls):
        aa = ease_out((u - 3.1 - i * 0.12) / 0.5) * fade
        paste_alpha(img, p, x, 850 + (1 - ease_out((u - 3.1 - i * 0.12) / 0.6)) * 18 + lift, aa); x += p.width + 14
    return img

def render_outro(u, slot):
    img = bg_at(u + TL_START["outro"]).convert("RGBA")
    hit = 2 * BAR  # final chord lands two bars into the outro
    pulse = 0.06 * math.exp(-max(0, u - hit) * 6) if u >= hit else 0
    logo_block(img, u, W / 2, 330, 0.9, 1.0, pulse)
    t = text_sprite(NAME, "InterDisplay-Bold.otf", 132, tracking=-3)
    paste_alpha(img, t, (W - t.width) / 2, 455 + (1 - ease_out((u - 0.3) / 0.7)) * 26, ease_out((u - 0.3) / 0.6))
    tg = text_sprite(TAGLINE, "Inter-Medium.otf", 38, (205, 210, 240))
    paste_alpha(img, tg, (W - tg.width) / 2, 630 + (1 - ease_out((u - 0.8) / 0.7)) * 18, ease_out((u - 0.8) / 0.6))
    # call to action
    cta = text_sprite("Try it free  →  " + URL, "Inter-SemiBold.otf", 30, (255, 255, 255))
    bw_, bh_ = cta.width + 60, 76
    btn = Image.new("RGBA", (bw_, bh_), (0, 0, 0, 0))
    ImageDraw.Draw(btn).rounded_rectangle([0, 0, bw_ - 1, bh_ - 1], radius=bh_ // 2, fill=(79, 70, 229, 255))
    btn.alpha_composite(cta, (30, (bh_ - cta.height) // 2))
    a = ease_out((u - 1.4) / 0.6)
    paste_alpha(img, btn, (W - bw_) / 2, 745 + (1 - a) * 20, a)
    sm = text_sprite("Free  ·  Private by design  ·  Works offline  ·  Any device", "Inter-Medium.otf", 26, (170, 176, 205))
    a = ease_out((u - 1.9) / 0.6)
    paste_alpha(img, sm, (W - sm.width) / 2, 860 + (1 - a) * 14, a)
    # fade to black at the very end
    end_u = u - (slot + 1.6 - 1.2)
    if end_u > 0:
        blk = Image.new("RGBA", (W, H), (0, 0, 0, int(255 * ease_io(end_u / 1.2))))
        img.alpha_composite(blk)
    return img

TL_START = {n: a for n, a, b in TL}
SLOT = {n: b - a for n, a, b in TL}

def render_seg(name, u):
    slot = SLOT[name]
    if name == "intro": return render_intro(u)
    if name == "outro": return render_outro(u, slot)
    if name == "devices": return render_devices(u, slot)
    return render_desktop(name, u, slot, enter=(name == "today"))

def render(t):
    # which segment(s)
    for i, (name, a, b) in enumerate(TL):
        if a <= t < b or (i == len(TL) - 1 and t >= a):
            cur = (name, t - a)
            nxt = TL[i + 1] if i + 1 < len(TL) else None
            prv = TL[i - 1] if i > 0 else None
            break
    name, u = cur
    if name == "today" and u < 0.9:  # intro hands over to the rising window
        return render_seg(name, u).convert("RGB")
    if nxt and t > nxt[1] - XF / 2 and name != "intro":
        A = render_seg(name, u); B = render_seg(nxt[0], t - nxt[1])
        m = ease_io((t - (nxt[1] - XF / 2)) / XF)
        return Image.blend(A.convert("RGB"), B.convert("RGB"), m)
    if prv and t < a + XF / 2 and prv[0] not in ("intro",):
        A = render_seg(prv[0], t - prv[1]); B = render_seg(name, u)
        m = ease_io((t - (a - XF / 2)) / XF)
        return Image.blend(A.convert("RGB"), B.convert("RGB"), m)
    if name == "intro" and nxt and t > nxt[1] - 0.25:
        pass
    return render_seg(name, u).convert("RGB")

def worker(args):
    i0, i1, path, fps = args
    p = subprocess.Popen(["ffmpeg", "-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(fps), "-i", "-",
                          "-c:v", "libx264", "-preset", "slow", "-crf", "17", "-tune", "animation", "-pix_fmt", "yuv420p", "-g", str(fps * 2), path], stdin=subprocess.PIPE)
    for i in range(i0, i1):
        p.stdin.write(render(i / fps).tobytes())
    p.stdin.close(); p.wait()
    return path

def cues():
    out = []
    for name, a, b in TL[1:]:
        out.append({"t": a, "kind": "whoosh"})
    for name, a, b in TL:
        if name not in CLIPS: continue
        cd = CLIPDATA[name]; speed = (cd["t1"] - cd["t0"]) / (b - a)
        for e in cd["evs"]:
            if e["type"] in ("click", "tap"): out.append({"t": a + (e["t"] - cd["t0"]) / speed, "kind": "click"})
            if e["type"] == "release": out.append({"t": a + (e["t"] - cd["t0"]) / speed, "kind": "drop"})
    out.append({"t": TL_START["outro"] + 0.1, "kind": "shimmer"})
    out.append({"t": 0.25, "kind": "shimmer"})
    return sorted(out, key=lambda c: c["t"])

if __name__ == "__main__":
    args = sys.argv[1:]
    fps = FPS
    if "--fps" in args: fps = int(args[args.index("--fps") + 1])
    if "--still" in args:
        for tt in args[args.index("--still") + 1:]:
            render(float(tt)).save(os.path.join(HERE, f"still-{tt}.png")); print("still", tt)
        sys.exit()
    t_a, t_b = 0.0, DURATION
    if "--preview" in args:
        j = args.index("--preview"); t_a, t_b = float(args[j + 1]), float(args[j + 2])
    n0, n1 = int(t_a * fps), int(t_b * fps)
    nproc = os.cpu_count() or 4
    step = math.ceil((n1 - n0) / nproc)
    jobs = [(n0 + k * step, min(n1, n0 + (k + 1) * step), os.path.join(HERE, f"part{k}.mp4"), fps) for k in range(nproc) if n0 + k * step < n1]
    with Pool(len(jobs)) as pool:
        parts = pool.map(worker, jobs)
    with open(os.path.join(HERE, "parts.txt"), "w") as f:
        for pth in parts: f.write(f"file '{pth}'\n")
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", os.path.join(HERE, "parts.txt"), "-c", "copy", os.path.join(HERE, "video.mp4")], check=True)
    json.dump({"duration": DURATION, "cues": cues(), "t_a": t_a}, open(os.path.join(HERE, "cues.json"), "w"), indent=1)
    print("video.mp4", t_a, t_b, "frames", n1 - n0)
