/**
 * The table's sound, synthesised with the Web Audio API.
 *
 * Nothing is downloaded: every sound here is built from oscillators and
 * shaped noise, so there are no audio files to ship and nothing to go
 * missing. Card sounds are noise through a moving filter — that is what
 * cardboard on cardboard actually is.
 *
 * The context is created on the first real gesture, because browsers will
 * not let it start any earlier.
 */

export type SoundName =
  | 'slide'
  | 'flip'
  | 'shuffle'
  | 'skip'
  | 'drawFour'
  | 'uno'
  | 'victory'
  | 'deny'
  | 'tick'
  | 'join';

let context: AudioContext | null = null;
let master: GainNode | null = null;
let muted = false;
let noise: AudioBuffer | null = null;

export function setMuted(value: boolean): void {
  muted = value;
  if (master && context) {
    master.gain.setTargetAtTime(value ? 0 : 0.9, context.currentTime, 0.02);
  }
}

/** Call from a click or key press — before that, browsers refuse to start. */
export function unlockAudio(): void {
  if (context) {
    if (context.state === 'suspended') void context.resume();
    return;
  }
  try {
    context = new AudioContext();
    master = context.createGain();
    master.gain.value = muted ? 0 : 0.9;
    master.connect(context.destination);
    noise = makeNoise(context);
  } catch {
    context = null;
  }
}

function makeNoise(ctx: AudioContext): AudioBuffer {
  const length = Math.floor(ctx.sampleRate * 0.6);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  let last = 0;
  for (let i = 0; i < length; i++) {
    // Slightly brown noise — less hiss, more paper.
    const white = Math.random() * 2 - 1;
    last = (last + 0.02 * white) / 1.02;
    data[i] = last * 3.2;
  }
  return buffer;
}

interface NoiseOptions {
  duration: number;
  from: number;
  to: number;
  gain?: number;
  q?: number;
  type?: BiquadFilterType;
  delay?: number;
}

function burst(options: NoiseOptions): void {
  if (!context || !master || !noise) return;
  const start = context.currentTime + (options.delay ?? 0);
  const source = context.createBufferSource();
  source.buffer = noise;

  const filter = context.createBiquadFilter();
  filter.type = options.type ?? 'bandpass';
  filter.Q.value = options.q ?? 1;
  filter.frequency.setValueAtTime(options.from, start);
  filter.frequency.exponentialRampToValueAtTime(Math.max(60, options.to), start + options.duration);

  const gain = context.createGain();
  const peak = options.gain ?? 0.35;
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(peak, start + Math.min(0.02, options.duration * 0.2));
  gain.gain.exponentialRampToValueAtTime(0.0001, start + options.duration);

  source.connect(filter).connect(gain).connect(master);
  source.start(start);
  source.stop(start + options.duration + 0.02);
}

interface ToneOptions {
  freq: number;
  duration: number;
  gain?: number;
  type?: OscillatorType;
  delay?: number;
  glide?: number;
}

function tone(options: ToneOptions): void {
  if (!context || !master) return;
  const start = context.currentTime + (options.delay ?? 0);
  const osc = context.createOscillator();
  osc.type = options.type ?? 'triangle';
  osc.frequency.setValueAtTime(options.freq, start);
  if (options.glide) {
    osc.frequency.exponentialRampToValueAtTime(options.glide, start + options.duration);
  }

  const gain = context.createGain();
  const peak = options.gain ?? 0.18;
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(peak, start + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + options.duration);

  osc.connect(gain).connect(master);
  osc.start(start);
  osc.stop(start + options.duration + 0.02);
}

export function play(name: SoundName): void {
  if (muted) return;
  if (!context) return;
  if (context.state === 'suspended') void context.resume();

  switch (name) {
    case 'slide':
      // A card leaving your hand and landing on the pile.
      burst({ duration: 0.11, from: 2600, to: 700, gain: 0.3, q: 0.8 });
      break;

    case 'flip':
      burst({ duration: 0.05, from: 5200, to: 2200, gain: 0.22, q: 1.5 });
      break;

    case 'shuffle':
      for (let i = 0; i < 7; i++) {
        burst({ duration: 0.07, from: 3000, to: 900, gain: 0.16, q: 0.7, delay: i * 0.045 });
      }
      break;

    case 'skip':
      // A whoosh past somebody.
      burst({ duration: 0.28, from: 4200, to: 320, gain: 0.28, q: 1.6, type: 'bandpass' });
      break;

    case 'drawFour':
      tone({ freq: 128, glide: 62, duration: 0.34, gain: 0.3, type: 'sine' });
      burst({ duration: 0.22, from: 900, to: 160, gain: 0.26, q: 0.9 });
      break;

    case 'uno':
      tone({ freq: 620, duration: 0.1, gain: 0.2 });
      tone({ freq: 930, duration: 0.16, gain: 0.22, delay: 0.09 });
      break;

    case 'victory':
      [523.25, 659.25, 783.99, 1046.5].forEach((freq, i) => {
        tone({ freq, duration: 0.24, gain: 0.17, delay: i * 0.085, type: 'triangle' });
      });
      break;

    case 'deny':
      tone({ freq: 190, glide: 120, duration: 0.16, gain: 0.16, type: 'sawtooth' });
      break;

    case 'tick':
      tone({ freq: 1250, duration: 0.035, gain: 0.09, type: 'square' });
      break;

    case 'join':
      tone({ freq: 500, duration: 0.09, gain: 0.13 });
      tone({ freq: 750, duration: 0.12, gain: 0.13, delay: 0.07 });
      break;
  }
}
