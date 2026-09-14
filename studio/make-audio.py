#!/usr/bin/env python3
"""Cinematic, restrained score + SFX for the PRISM films (numpy synthesis)."""
import numpy as np, os, wave, struct, math

SR = 24000
OUT = os.path.join(os.path.dirname(__file__), "sfx")
os.makedirs(OUT, exist_ok=True)

def t(dur): return np.linspace(0, dur, int(SR*dur), endpoint=False).astype(np.float32)
def expdec(n, k): return np.exp(-np.linspace(0, k, n))
def sine(freq, dur, phase=0.0):
    tt = t(dur)
    if np.isscalar(freq):
        return np.sin(2*np.pi*freq*tt + phase)
    return np.sin(2*np.pi*np.cumsum(freq)/SR + phase)
def softclip(x, drive=1.0):
    return np.tanh(x*drive)/np.tanh(drive)
def adsr(n, a=0.02, d=0.1, s=0.7, r=0.2):
    env = np.ones(n)
    ai, di, ri = int(a*SR), int(d*SR), int(r*SR)
    ai=min(ai,n); di=min(di,n-ai); ri=min(ri,n)
    if ai>0: env[:ai] = np.linspace(0,1,ai)
    if di>0: env[ai:ai+di] = np.linspace(1,s,di)
    if ri>0: env[-ri:] = np.linspace(env[-ri-1] if n-ri>0 else s, 0, ri)
    return env
from scipy.signal import butter, lfilter
def lp(x, cutoff_norm, order=2):
    if np.isscalar(cutoff_norm):
        cf = float(np.clip(cutoff_norm, 1e-4, 0.499))
        b, a = butter(order, cf, btype="low")
        return lfilter(b, a, x).astype(np.float32)
    # time-varying: blockwise
    out = np.zeros_like(x); bs = SR//20; i = 0
    while i < len(x):
        j = min(i+bs, len(x))
        b, a = butter(order, float(np.clip(cutoff_norm[min(i,len(cutoff_norm)-1)], 1e-4, .499)), btype="low")
        out[i:j] = lfilter(b, a, x[i:j])
        i = j
    return out
def hp(x, cutoff_norm, order=2):
    cf = float(np.clip(cutoff_norm, 1e-4, 0.499))
    b, a = butter(order, cf, btype="high")
    return lfilter(b, a, x).astype(np.float32)
def stereo(l, r=None):
    if r is None: r = l
    n = min(len(l), len(r)); l, r = l[:n].astype(np.float32), r[:n].astype(np.float32)
    return np.stack([l, r], axis=1)
def save(name, x, norm=0.89):
    x = np.asarray(x)
    if x.ndim == 1: x = stereo(x)
    peak = np.max(np.abs(x)) + 1e-12
    x = x/peak*norm
    pcm = (np.asarray(x,dtype=np.float32)*32767).astype(np.int16)
    with wave.open(os.path.join(OUT, name), "w") as w:
        w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
        w.writeframes(pcm.tobytes())
    print("wrote", name, f"{len(x)/SR:.1f}s")

rng = np.random.default_rng(7)

# ---------------------------------------------------------------- bed: long
def long_bed(dur=660):
    n = int(SR*dur); tt = (np.arange(n,dtype=np.float32)/SR)
    # slow evolving minor pad: A1/A2/E3/C#3-ish, very low
    base_freqs = [55.0, 82.41, 110.0, 164.81, 220.0]
    sig = np.zeros(n)
    for i, f in enumerate(base_freqs):
        lfo = 0.5+0.5*np.sin(2*np.pi*(0.01+0.004*i)*tt + i)
        det = 1 + 0.0015*np.sin(2*np.pi*0.007*tt + i*2)
        ph = sine(f*det, dur)
        sig += (0.18/(i+1)) * (0.5+0.5*lfo) * ph
    # shimmer, very quiet, enters slowly
    sh = np.zeros(n)
    for f in [440.0, 554.37, 659.25]:
        sh += 0.02*np.sin(2*np.pi*f*tt + np.sin(2*np.pi*0.01*tt))
    env_sh = np.clip((tt-30)/60, 0, 1)
    sig += sh*env_sh
    # airy noise
    nz = rng.standard_normal(n).astype(np.float32)
    nz = lp(nz, 0.02)
    sig += (0.05*nz*(0.4+0.6*np.abs(np.sin(2*np.pi*tt/47)))).astype(np.float32)
    del nz
    # slow heartbeat pulse every ~4.6s, soft
    pulse = np.zeros(n)
    period = int(SR*4.6)
    for k in range(period, n, period):
        ln = int(SR*0.5)
        if k+ln > n: break
        e = expdec(ln, 5)
        pulse[k:k+ln] += 0.5*e*np.sin(2*np.pi*48*np.arange(ln)/SR)
    sig += 0.10*pulse
    sig = softclip(sig, 1.2)
    sig = stereo(sig*0.9, np.roll(sig, int(SR*0.012)))
    # global fade in/out
    fi = int(SR*4); fo = int(SR*8)
    sig[:fi, :] *= np.linspace(0,1,fi)[:,None]
    sig[-fo:, :] *= np.linspace(1,0,fo)[:,None]
    save("bed-long.wav", sig, norm=0.5)

# ---------------------------------------------------------------- reel bed: pulse ~96 BPM
def reel_bed(dur=62):
    n = int(SR*dur); tt = (np.arange(n,dtype=np.float32)/SR)
    bpm = 96; beat = 60/bpm
    sig = np.zeros(n)
    # bass pulse on each beat
    for b in np.arange(0, dur, beat):
        k = int(b*SR); ln = int(SR*0.34)
        if k+ln > n: break
        e = expdec(ln, 6)
        f = np.concatenate([np.linspace(110, 70, int(ln*0.3)), np.full(ln-int(ln*0.3), 65)])
        seg = e*np.sin(2*np.pi*np.cumsum(f)/SR)
        sig[k:k+ln] += 0.9*seg
        # tick (hat-ish)
        hn = int(SR*0.05)
        h = rng.standard_contents if False else rng.standard_normal(hn)*expdec(hn,30)
        h = hp(h, 0.3)
        if k+hn<=n: sig[k:k+hn] += 0.12*h
    # offbeat tick
    for b in np.arange(beat/2, dur, beat):
        k=int(b*SR); hn=int(SR*0.04)
        h = rng.standard_normal(hn)*expdec(hn,40); h=hp(h,0.4)
        if k+hn<=n: sig[k:k+hn] += 0.07*h
    # minor pad underneath
    pad = sum(0.05*np.sin(2*np.pi*f*tt) for f in [55, 82.4, 110, 164.8])
    sig += pad
    # riser in last 4s
    rt = np.clip((tt-(dur-4))/4, 0, 1)
    rz = lp(rng.standard_normal(n), 0.01+0.2*rt[:,None].repeat(0) if False else (0.01+0.2*rt))
    sig += 0.10*rt*rz
    sig = softclip(sig, 1.4)
    sig = stereo(sig, np.roll(sig, int(SR*0.006)))
    fi=int(SR*.5); fo=int(SR*1.5)
    sig[:fi]*=np.linspace(0,1,fi)[:,None]; sig[-fo:]*=np.linspace(1,0,fo)[:,None]
    save("bed-reel.wav", sig, norm=0.55)

# ---------------------------------------------------------------- SFX
def whoosh(dur=1.6):
    n=int(SR*dur); tt=np.arange(n)/SR
    x=rng.standard_normal(n)
    # swept band: modulate lowpass
    cut = 0.02 + 0.5*np.sin(np.pi*np.clip(tt/dur,0,1))**2
    # crude: sum of delays; instead use spectral-free approach: highpass then envelope by chunks
    y = lp(x, 0.4)
    env = np.sin(np.pi*np.clip(tt/dur,0,1))**2
    y *= env
    # pitch-ish sweep using sine whistle
    f = 120+700*np.sin(np.pi*tt/dur)
    y += 0.12*env*np.sin(2*np.pi*np.cumsum(f)/SR)
    save("whoosh.wav", stereo(y, np.roll(y, int(SR*0.02))), norm=0.5)

def impact(dur=2.2):
    n=int(SR*dur); tt=np.arange(n)/SR
    # sub thump
    f = np.concatenate([np.linspace(140,42,int(n*0.5)), np.full(n-int(n*0.5),40)])
    sub = np.sin(2*np.pi*np.cumsum(f)/SR)*expdec(n,3.5)
    # crack
    cr = rng.standard_normal(int(SR*0.18))*expdec(int(SR*0.18),22)
    sig = np.zeros(n); sig[:len(cr)] += 0.8*cr
    sig += 0.9*sub
    sig = softclip(sig, 2)
    save("impact.wav", sig, norm=0.7)

def confirm(dur=1.4):
    # two-note soft chime (A4 -> E5), green moments
    n1=int(SR*0.5); n2=int(SR*0.9)
    a=sine(440, n1/SR)*adsr(n1,0.005,0.08,0.5,0.25)
    b=sine(659.25, n2/SR)*adsr(n2,0.005,0.1,0.5,0.4)
    sig=np.zeros(int(SR*dur)); sig[:n1]+=0.5*a
    k=int(SR*0.18); sig[k:k+n2]+=0.5*b
    # soft fifth
    sig[k:k+n2]+=0.2*sine(330, n2/SR)*adsr(n2,.01,.2,.4,.5)
    save("confirm.wav", sig, norm=0.5)

def tick(dur=0.12):
    n=int(SR*dur)
    x=rng.standard_normal(n)*expdec(n,60)
    x=hp(x,0.5)
    save("tick.wav", x, norm=0.35)

def riser(dur=3.0):
    n=int(SR*dur); tt=np.arange(n)/SR
    x=lp(rng.standard_normal(n), 0.02+0.5*tt/dur)
    x *= (tt/dur)**2
    # rising tone
    f=200+900*(tt/dur)**2
    x += 0.08*(tt/dur)*np.sin(2*np.pi*np.cumsum(f)/SR)
    save("riser.wav", x, norm=0.45)

def pop(dur=0.18):
    n=int(SR*dur)
    f=np.linspace(520,240,n)
    x=np.sin(2*np.pi*np.cumsum(f)/SR)*expdec(n,9)
    save("pop.wav", x, norm=0.4)

if __name__ == "__main__":
    long_bed()
    reel_bed()
    whoosh(); impact(); confirm(); tick(); riser(); pop()
    print("audio complete")
