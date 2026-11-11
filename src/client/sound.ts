// Sound effects, synthesized with the Web Audio API: no audio files to license, host or download.
// Browsers only allow audio after a tap, so the context is created on the first user gesture.
// The mute choice is remembered (localStorage when available) and is shown by the speaker button in the header.

export type Sfx = "click" | "lock" | "pop" | "bomb" | "boom" | "correct" | "wrong" | "tick" | "siren" | "reveal" | "whoosh" | "coin" | "fanfare";

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let muted = (() => { try { return localStorage.getItem("fu-muted") === "1"; } catch { return false; } })();

export const isMuted = () => muted;
export function setMuted(m: boolean) {
  muted = m;
  try { localStorage.setItem("fu-muted", m ? "1" : "0"); } catch { /* private mode */ }
  if (master) master.gain.value = m ? 0 : 0.5;
}

/** Call from any tap/click handler: creates / resumes the audio context (autoplay policy). */
export function unlockAudio() {
  try {
    if (!ctx) {
      const AC = window.AudioContext ?? (window as any).webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = muted ? 0 : 0.5;
      master.connect(ctx.destination);
    }
    if (ctx.state === "suspended") void ctx.resume();
  } catch { /* no audio available: the game is fully playable without it */ }
}

function tone(freq: number, dur: number, type: OscillatorType = "sine", vol = 0.3, at = 0, slideTo?: number) {
  if (!ctx || !master) return;
  const t0 = ctx.currentTime + at;
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t0);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(vol, t0 + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g).connect(master);
  o.start(t0);
  o.stop(t0 + dur + 0.02);
}

function noise(dur: number, vol = 0.4, from = 3000, to = 200, at = 0) {
  if (!ctx || !master) return;
  const t0 = ctx.currentTime + at;
  const buf = ctx.createBuffer(1, Math.max(1, Math.floor(ctx.sampleRate * dur)), ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource(); src.buffer = buf;
  const f = ctx.createBiquadFilter(); f.type = "lowpass";
  f.frequency.setValueAtTime(from, t0); f.frequency.exponentialRampToValueAtTime(to, t0 + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(vol, t0); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(f).connect(g).connect(master);
  src.start(t0);
}

const NOTE = (n: number) => 440 * 2 ** ((n - 9) / 12); // semitones above C4... n=9 is A4

export function play(s: Sfx) {
  if (muted || !ctx) return;
  switch (s) {
    case "click": return tone(620, 0.05, "square", 0.12);
    case "lock": tone(480, 0.07, "square", 0.15); return tone(760, 0.1, "square", 0.15, 0.07);
    case "pop": return tone(520, 0.12, "sine", 0.3, 0, 1100);
    case "bomb": return tone(1000, 0.35, "sawtooth", 0.18, 0, 160);
    case "boom": noise(0.6, 0.6, 2500, 90); return tone(90, 0.5, "sine", 0.5, 0, 40);
    case "correct": [0, 4, 7, 12].forEach((n, i) => tone(NOTE(n), 0.16, "triangle", 0.28, i * 0.08)); return;
    case "wrong": return tone(170, 0.32, "sawtooth", 0.22, 0, 110);
    case "tick": return tone(1500, 0.03, "square", 0.1);
    case "siren": for (let i = 0; i < 4; i++) tone(i % 2 ? 900 : 640, 0.16, "square", 0.16, i * 0.17); return;
    case "reveal": return tone(300, 0.4, "triangle", 0.25, 0, 900);
    case "whoosh": return noise(0.25, 0.12, 4000, 400);
    case "coin": tone(988, 0.08, "square", 0.16); return tone(1319, 0.2, "square", 0.16, 0.08);
    case "fanfare": [0, 4, 7, 12, 7, 12, 16].forEach((n, i) => tone(NOTE(n), i === 6 ? 0.5 : 0.18, "triangle", 0.3, i * 0.14)); return;
  }
}
