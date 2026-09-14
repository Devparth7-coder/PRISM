#!/usr/bin/env python3
"""Assemble PRISM films: normalize trims, concat, then mix VO + score + SFX.

Stage 1 (--video): build per-segment mp4s and a silent master.
Stage 2 (--audio): build VO/score mix and mux final.
"""
import argparse, json, os, subprocess, sys, math

ROOT = os.path.dirname(__file__)
REC = os.path.join(ROOT, "rec")
SEG = os.path.join(ROOT, "segments")
OUTD = os.path.join(ROOT, "films")
VO = os.path.join(ROOT, "vo")
SFX = os.path.join(ROOT, "sfx")
FF = os.path.join(ROOT, "bin", "ffmpeg")
FP = os.path.join(ROOT, "bin", "ffprobe")
FPS = 25
os.makedirs(SEG, exist_ok=True)
os.makedirs(OUTD, exist_ok=True)

# id, source, ss, dur, ken-burns push, extra note
LONG = [
    ("01-landing",   "s01-landing.webm",       1.0, 17.0, False),
    ("02-terminal",  "terminal.webm",          0.4, 36.0, False),
    ("03-title",     "title.webm",             0.4,  8.8, True),
    ("04-problem",   "problem.webm",           0.4, 25.8, True),
    ("05-login",     "s02-login.webm",         3.0, 10.9, False),
    ("06-pipeline",  "pipeline.webm",          0.4, 40.5, True),
    ("07-webhook",   "webhook.webm",           0.4, 24.8, True),
    ("08-prsha",     "s02-open-review.webm",   1.5, 12.0, False),
    ("09-context",   "context.webm",           0.4, 43.0, True),
    ("10-static",    "static.webm",            0.4, 23.8, True),
    ("11-deepdet",   "s03-review-deep.webm",   2.2, 10.0, False),
    ("12-mesh",      "mesh.webm",              0.4, 41.0, True),
    ("13-critic",    "critic.webm",            0.4, 37.0, True),
    ("14-chain",     "chain.webm",             0.3, 17.8, True),
    ("15-evidence",  "s03-review-deep.webm",   2.5, 18.0, False),
    ("16-criticfoot","s03-review-deep.webm",  19.0,  8.5, False),
    ("17-artifacts", "s03-review-deep.webm",  33.2,  5.0, False),
    ("18-risk",      "risk.webm",              0.4, 21.2, True),
    ("19-riskpanel", "s02-open-review.webm",  10.5, 11.0, False),
    ("20-github",    "github.webm",            0.3, 29.0, False),
    ("21-regression","regression.webm",        0.3, 25.8, True),
    ("22-fixreal",   "s07-fix-cycle.webm",    10.0, 14.3, False),
    # six observability stops (warm 60.8s tour: login ~3.5s, each stop ~9.5s)
    ("23a-findings", "s06-tour.webm",          3.6,  8.0, False),
    ("23b-agents",   "s06-tour.webm",         11.2,  8.0, False),
    ("23c-runs",     "s06-tour.webm",         21.5,  8.0, False),
    ("23d-analytics","s06-tour.webm",         30.6,  8.0, False),
    ("23e-policies", "s06-tour.webm",         39.0,  8.0, False),
    ("23f-integrations","s06-tour.webm",      48.6,  8.0, False),
    ("24-pipelog",   "s03-review-deep.webm",  37.5,  9.0, False),
    ("25a-coptype",  "s04-copilot.webm",       6.0,  8.0, False),
    ("25b-copans1",  "s04-copilot.webm",      29.0,  9.5, False),
    ("25c-copans2",  "s04-copilot.webm",      31.5,  8.0, False),
    ("26-palette",   "s05-palette.webm",       5.5,  8.0, False),
    ("27-final",     "final.webm",             0.3, 18.5, True),
]
FINAL_HOLD = 28.0  # bright freeze-frame brand hold
FADE_IN, FADE_OUT = 0.45, 0.55

# vertical reel (1080x1920)
REEL = [
    ("r1-hook",   "v-hook.webm",   0.3, 3.2, False),
    ("r2-diff",   "v-diff.webm",   0.3, 5.0, True),
    ("r3-title",  "v-title.webm",  0.3, 4.2, True),
    ("r4-pipe",   "v-pipe.webm",   0.2, 5.4, True),
    ("r5-mesh",   "v-mesh.webm",   0.3, 6.8, False),
    ("r6-critic", "v-critic.webm", 0.3, 6.0, True),
    ("r7-evidence","v1-review.webm",14.0, 7.0, False),
    ("r8-risk",   "v-risk.webm",   0.2, 4.8, True),
    ("r9-fix",    "v-fix.webm",    0.3, 7.0, True),
    ("r10-final", "v-final.webm",  0.3, 8.0, True),
]

def run(cmd):
    print("+", " ".join(cmd[:3]), "...")
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        print(r.stderr[-3000:]); raise SystemExit(f"cmd failed: {cmd[0]}")

def dur_of(p):
    r = subprocess.run([FP,"-v","error","-show_entries","format=duration","-of","csv=p=0",p],capture_output=True,text=True)
    return float(r.stdout.strip())

def kenburns_vf(w,h,dur,push=True,fades=True,fi=FADE_IN,fo=FADE_OUT):
    bg = "0x08090b"
    base = f"fps={FPS},scale={w}:{h}:force_original_aspect_ratio=decrease,pad={w}:{h}:(ow-iw)/2:(oh-ih)/2:color={bg},setsar=1"
    if push:
        z = 1.05
        frames = int(dur*FPS)
        # slow steady push, zoompan on already-scaled stream
        base += (f",zoompan=z='min({z},{1.0}+{z-1:.5f}*on/{frames})'"
                 f":x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s={w}x{h}:fps={FPS}")
    if fades:
        base += f",fade=t=in:st=0:d={fi},fade=t=out:st={dur-fo:.3f}:d={fo}"
    return base + ",format=yuv420p"

def build_segments(manifest, w, h, prefix, fi, fo):
    files = []
    for (sid, src, ss, dur, kb) in manifest:
        out = os.path.join(SEG, f"{prefix}-{sid}.mp4")
        vf = kenburns_vf(w,h,dur,push=kb,fi=fi,fo=fo)
        run([FF,"-y","-loglevel","error","-ss",str(ss),"-i",os.path.join(REC,src),
             "-an","-t",str(dur),"-vf",vf,
             "-c:v","libx264","-preset","fast","-crf","19","-r",str(FPS),"-pix_fmt","yuv420p",out])
        files.append((sid,out,dur))
    return files

def freeze_hold(src, ss, dur, w, h, prefix, sid):
    """Bright frame freeze with slow push + fade out."""
    png = os.path.join(SEG, f"{prefix}-{sid}.png")
    run([FF,"-y","-loglevel","error","-ss",str(ss),"-i",os.path.join(REC,src),"-frames:v","1",png])
    out = os.path.join(SEG, f"{prefix}-{sid}.mp4")
    frames=int(dur*FPS)
    vf=(f"scale={w}:{h}:force_original_aspect_ratio=decrease,pad={w}:{h}:(ow-iw)/2:(oh-ih)/2:color=0x08090b,setsar=1,"
        f"zoompan=z='min(1.06,1.0+0.000015*on)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d={frames}:s={w}x{h}:fps={FPS},"
        f"fade=t=in:st=0:d=0.4,fade=t=out:st={dur-1.6:.3f}:d=1.6,format=yuv420p")
    run([FF,"-y","-loglevel","error","-loop","1","-i",png,"-t",str(dur),"-vf",vf,
         "-c:v","libx264","-preset","fast","-crf","19","-r",str(FPS),"-pix_fmt","yuv420p",out])
    return out

def concat(files, master):
    lst = os.path.join(SEG, "concat-"+os.path.basename(master).replace(".mp4",".txt"))
    with open(lst,"w") as f:
        for _,p,_d in files: f.write(f"file '{p}'\n")
    run([FF,"-y","-loglevel","error","-f","concat","-safe","0","-i",lst,"-c","copy",master])

def video_stage(which):
    if which=="long":
        files = build_segments(LONG,1920,1080,"L",0.45,0.55)
        hold = freeze_hold("final.webm", 16.8, FINAL_HOLD, 1920,1080,"L","28-hold")
        files.append(("28-hold",hold,FINAL_HOLD))
        total = sum(d for _,_,d in files)
        concat(files, os.path.join(SEG,"master-long-silent.mp4"))
        print("LONG master seconds:", total)
    else:
        files = build_segments(REEL,1080,1920,"V",0.12,0.18)
        total = sum(d for _,_,d in files)
        concat(files, os.path.join(SEG,"master-reel-silent.mp4"))
        print("REEL master seconds:", total)

# --------------------------------------------------------------- audio
def timeline(files_with_hold):
    t=0.0; out={}
    for sid,_p,d in files_with_hold:
        out[sid]=t; t+=d
    return out

def audio_stage(which):
    if which=="long":
        files=build_filelist_long()
        tl=timeline(files)
        T=sum(d for _,_,d in files)
        # VO clip -> start at (segment start + offset)
        vo_map=[
            ("l01-opening.mp3", tl["01-landing"]+2.5),
            ("l02-problem.mp3", tl["04-problem"]+1.2),
            ("l03-what.mp3",    tl["06-pipeline"]+1.0),
            ("l04-integration.mp3", tl["07-webhook"]+1.0),
            ("l05-context.mp3", tl["09-context"]+1.0),
            ("l06-static.mp3",  tl["10-static"]+1.0),
            ("l07-mesh.mp3",    tl["12-mesh"]+1.0),
            ("l08-critic.mp3",  tl["13-critic"]+1.0),
            ("l09-evidence.mp3",tl["14-chain"]+1.0),
            ("l10-risk.mp3",    tl["18-risk"]+1.0),
            ("l11-publish.mp3", tl["20-github"]+1.0),
            ("l12-rereview.mp3",tl["21-regression"]+1.0),
            ("l13-observability.mp3", tl["23a-findings"]+1.0),
            ("l14-final.mp3",   tl["27-final"]+1.0),
        ]
        sfx_map=[
            ("whoosh.wav", 0.4, 0.35),
            ("impact.wav", tl["03-title"]+0.2, 0.55),
            ("pop.wav", tl["06-pipeline"]+1.5, .18),
            ("pop.wav", tl["06-pipeline"]+4.5, .18),
            ("pop.wav", tl["06-pipeline"]+7.5, .18),
            ("pop.wav", tl["06-pipeline"]+10.5, .18),
            ("pop.wav", tl["06-pipeline"]+13.5, .2),
            ("pop.wav", tl["06-pipeline"]+22.0, .2),
            ("pop.wav", tl["06-pipeline"]+26.0, .18),
            ("pop.wav", tl["06-pipeline"]+29.5, .18),
            ("pop.wav", tl["06-pipeline"]+32.5, .22),
            ("confirm.wav", tl["13-critic"]+22.6, .4),
            ("impact.wav", tl["18-risk"]+3.4, .45),
            ("confirm.wav", tl["22-fixreal"]+6.2, .5),
            ("confirm.wav", tl["27-final"]+2.2, .4),
            ("impact.wav", tl["28-hold"]+0.2, .5),
        ]
        bed="bed-long.wav"; bed_vol=0.55; master=os.path.join(SEG,"master-long-silent.mp4"); FINAL_FADE=4.0
        out=os.path.join(OUTD,"PRISM-Full-Product-Demonstration.mp4")
    else:
        files=[(sid,os.path.join(SEG,f"V-{sid}.mp4"),dur) for (sid,_src,_ss,dur,_kb) in REEL]
        tl=timeline(files); T=sum(d for _,_,d in files)
        vo_map=[("s1-vo.mp3",0.8),("s2-vo.mp3",42.0)]
        sfx_map=[
            ("impact.wav", 2.9, .6),
            ("tick.wav", tl["r4-pipe"]+.4, .3),
            ("tick.wav", tl["r4-pipe"]+.9, .3),
            ("tick.wav", tl["r4-pipe"]+1.4, .3),
            ("tick.wav", tl["r4-pipe"]+1.9, .3),
            ("tick.wav", tl["r4-pipe"]+2.4, .3),
            ("pop.wav", tl["r5-mesh"]+.5, .25),
            ("pop.wav", tl["r6-critic"]+4.6, .3),
            ("impact.wav", tl["r8-risk"]+2.4, .55),
            ("confirm.wav", tl["r9-fix"]+5.2, .55),
            ("impact.wav", tl["r10-final"]+.4, .5),
        ]
        bed="bed-reel.wav"; bed_vol=0.75; master=os.path.join(SEG,"master-reel-silent.mp4"); FINAL_FADE=2.6
        out=os.path.join(OUTD,"PRISM-AI-Code-Review-Reel.mp4")
    # check VO presence
    missing=[v for v,_ in vo_map if not os.path.exists(os.path.join(VO,v))]
    if missing:
        print("MISSING VO:",missing); raise SystemExit(2)
    build_mix(T, vo_map, sfx_map, bed, bed_vol, out, master, FINAL_FADE)

def build_filelist_long():
    files=[]
    for (sid,_src,_ss,dur,_kb) in LONG:
        files.append((sid,os.path.join(SEG,f"L-{sid}.mp4"),dur))
    files.append(("28-hold",os.path.join(SEG,"L-28-hold.mp4"),FINAL_HOLD))
    return files

def build_mix(T, vo_map, sfx_map, bed, bed_vol, out, master, final_fade=4.0):
    # 1) VO concatenation with delays
    cmd=[FF,"-y","-loglevel","error"]
    for v,_st in vo_map: cmd += ["-i",os.path.join(VO,v)]
    for s,_st,_g in sfx_map: cmd += ["-i",os.path.join(SFX,s)]
    cmd += ["-i",os.path.join(SFX,bed)]
    nvo=len(vo_map); nsfx=len(sfx_map); bed_idx=nvo+nsfx
    fc=[]
    # normalize VO voices to stereo 48k
    for i in range(nvo):
        ms=int(vo_map[i][1]*1000)
        fc.append(f"[{i}:a]aresample=48000,volume=1.0,adelay={ms}|{ms}[v{i}]")
    for i,(s,st,g) in enumerate(sfx_map):
        idx=nvo+i; ms=int(st*1000)
        fc.append(f"[{idx}:a]aresample=48000,volume={g},adelay={ms}|{ms}[x{i}]")
    fc.append(f"[{bed_idx}:a]aresample=48000,volume={bed_vol},atrim=0:{T:.3f},apad=whole_dur={T:.3f}[bed]")
    # VO mix
    vmix="".join(f"[v{i}]" for i in range(nvo))
    if nvo == 1:
        fc.append(f"[v0]anull,asplit=2[voKraw][voM];[voKraw]apad=whole_dur={T:.3f},atrim=0:{T:.3f}[voK]")
    else:
        fc.append(f"{vmix}amix=inputs={nvo}:normalize=0:dropout_transition=0,asplit=2[voKraw][voM];[voKraw]apad=whole_dur={T:.3f},atrim=0:{T:.3f}[voK]")
    # sfx mix
    if nsfx:
        smix="".join(f"[x{i}]" for i in range(nsfx))
        fc.append(f"{smix}amix=inputs={nsfx}:normalize=0:dropout_transition=0[sfx]")
        # duck bed under VO
        fc.append(f"[bed][voK]sidechaincompress=threshold=0.06:ratio=5:attack=250:release=900:makeup=1,apad=whole_dur={T:.3f},atrim=0:{T:.3f}[dbed]")
        fc.append(f"[dbed][sfx]amix=inputs=2:normalize=0:dropout_transition=0:duration=first,apad=whole_dur={T:.3f},atrim=0:{T:.3f}[bg]")
    else:
        fc.append(f"[bed][voK]sidechaincompress=threshold=0.06:ratio=5:attack=250:release=900,apad=whole_dur={T:.3f},atrim=0:{T:.3f}[bg]")
    fo = final_fade
    fc.append(f"[bg][voM]amix=inputs=2:normalize=0:dropout_transition=0:duration=first,apad=whole_dur={T:.3f},atrim=0:{T:.3f},alimiter=limit=0.95,afade=t=out:st={T-fo:.3f}:d={fo}[aout]")
    cmd += ["-filter_complex",";".join(fc),"-map","0:v?"]  # placeholder; we mux separately below
    # Simpler robust route: render audio wav first (video-less graph), then mux.
    acmd=[FF,"-y","-loglevel","error"]
    for v,_st in vo_map: acmd += ["-i",os.path.join(VO,v)]
    for s,_st,_g in sfx_map: acmd += ["-i",os.path.join(SFX,s)]
    acmd += ["-i",os.path.join(SFX,bed)]
    acmd += ["-filter_complex",";".join(fc),"-map","[aout]","-t",f"{T:.3f}","-c:a","pcm_s16le",os.path.join(SEG,"mix.wav")]
    run(acmd)
    run([FF,"-y","-loglevel","error","-i",master,"-i",os.path.join(SEG,"mix.wav"),
         "-map","0:v:0","-map","1:a:0","-c:v","copy","-c:a","aac","-b:a","192k","-movflags","+faststart",out])
    print("WROTE",out)

if __name__=="__main__":
    ap=argparse.ArgumentParser()
    ap.add_argument("stage",choices=["video","audio","both"])
    ap.add_argument("--which",choices=["long","reel","both"],default="both")
    a=ap.parse_args()
    targets=[a.which] if a.which!="both" else ["long","reel"]
    if a.stage in ("video","both"):
        for t in targets: video_stage(t)
    if a.stage in ("audio","both"):
        for t in targets: audio_stage(t)
