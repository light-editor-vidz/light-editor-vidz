import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PreviewEngine, configureFilter, type FilterParams, type PreviewParams } from "./previewEngine";
import { TARGET_PEAK, butterworthQ, qToDb } from "./helpers";

// ─── Un AudioContext factice, juste assez pour suivre ce que fait le moteur ─────────────────

class FakeParam {
  value = 1;
  events: [string, number, number][] = [];
  cancelScheduledValues = vi.fn(() => {
    this.events = [];
  });
  setValueAtTime(value: number, time: number) {
    this.events.push(["set", value, time]);
  }
  linearRampToValueAtTime(value: number, time: number) {
    this.events.push(["ramp", value, time]);
  }
}

class FakeNode {
  connect = vi.fn();
  disconnect = vi.fn();
}

class FakeGain extends FakeNode {
  gain = new FakeParam();
}

class FakeBiquad extends FakeNode {
  type = "lowpass";
  frequency = new FakeParam();
  Q = new FakeParam();
  gain = new FakeParam();
}

class FakeSource extends FakeNode {
  buffer: FakeBuffer | null = null;
  playbackRate = new FakeParam();
  onended: (() => void) | null = null;
  start = vi.fn();
  stop = vi.fn();
}

class FakeBuffer {
  constructor(
    public numberOfChannels: number,
    public length: number,
    public sampleRate: number,
    public data: Float32Array[] = Array.from({ length: numberOfChannels }, () => new Float32Array(length)),
  ) {}
  get duration() {
    return this.length / this.sampleRate;
  }
  getChannelData(channel: number) {
    return this.data[channel];
  }
}

const contexts: FakeContext[] = [];

class FakeContext {
  currentTime = 0;
  sampleRate = 48000;
  state: "running" | "suspended" = "running";
  destination = new FakeNode();
  sources: FakeSource[] = [];
  gains: FakeGain[] = [];
  biquads: FakeBiquad[] = [];
  analyser = Object.assign(new FakeNode(), {
    fftSize: 0,
    smoothingTimeConstant: 0,
    frequencyBinCount: 256,
  });
  decoded = new FakeBuffer(2, 480000, 48000);
  resume = vi.fn(async () => {
    this.state = "running";
  });
  close = vi.fn(async () => {});
  constructor() {
    contexts.push(this);
  }
  createGain() {
    const g = new FakeGain();
    this.gains.push(g);
    return g;
  }
  createBiquadFilter() {
    const b = new FakeBiquad();
    this.biquads.push(b);
    return b;
  }
  createAnalyser() {
    return this.analyser;
  }
  createBufferSource() {
    const s = new FakeSource();
    this.sources.push(s);
    return s;
  }
  createBuffer(channels: number, length: number, rate: number) {
    return new FakeBuffer(channels, length, rate);
  }
  decodeAudioData = vi.fn(async () => this.decoded);
}

/** Rendu hors ligne factice : renvoie un signal dont le pic est connu. */
let offlinePeak = 0.25;
class FakeOffline extends FakeContext {
  constructor(
    public channels: number,
    public length: number,
    rate: number,
  ) {
    super();
    this.sampleRate = rate;
  }
  startRendering = vi.fn(async () => {
    const out = new FakeBuffer(this.channels, this.length, this.sampleRate);
    out.data[0][0] = -offlinePeak;
    return out;
  });
}

beforeEach(() => {
  contexts.length = 0;
  offlinePeak = 0.25;
  vi.stubGlobal("AudioContext", FakeContext);
  vi.stubGlobal("OfflineAudioContext", FakeOffline);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const NO_FILTER: FilterParams = { type: "", freq: 1000, slope: 12, q: Math.SQRT1_2, bandwidth: 500 };
const params = (over: Partial<PreviewParams> = {}): PreviewParams => ({
  fadeIn: 0,
  fadeOut: 0,
  curve: "linear",
  speed: 1,
  normalize: false,
  filter: NO_FILTER,
  ...over,
});

/** Un moteur chargé avec un fichier de 10 s (le décodage factice dure 10 s à 48 kHz). */
async function loadedEngine(over: Partial<PreviewParams> = {}) {
  const engine = new PreviewEngine();
  const buffer = await engine.decode(new ArrayBuffer(8));
  engine.setParams(params(over));
  engine.load(buffer, 10, [0.1, 0.5, 0.9]);
  const ctx = contexts[0];
  return { engine, ctx, buffer };
}

describe("configureFilter", () => {
  const nodes = () => Array.from({ length: 4 }, () => new FakeBiquad() as unknown as BiquadFilterNode);

  it("makes every stage an exact identity without a filter", () => {
    const n = nodes();
    configureFilter(n, 48000, NO_FILTER);
    for (const node of n) {
      expect(node.type).toBe("peaking");
      expect(node.gain.value).toBe(0);
    }
  });

  it("uses one stage with the given Q for a 12 dB low-pass, Q in decibels", () => {
    const n = nodes();
    configureFilter(n, 48000, { ...NO_FILTER, type: "lowpass", freq: 800, q: 2 });
    expect(n[0].type).toBe("lowpass");
    expect(n[0].frequency.value).toBe(800);
    expect(n[0].Q.value).toBeCloseTo(qToDb(2));
    expect(n[1].type).toBe("peaking");
  });

  it("treats the rounded default Q as the default", () => {
    const n = nodes();
    configureFilter(n, 48000, { ...NO_FILTER, type: "highpass", q: 0.707 });
    expect(n[0].Q.value).toBeCloseTo(qToDb(Math.SQRT1_2));
  });

  it("cascades Butterworth stages for steeper slopes", () => {
    const n = nodes();
    configureFilter(n, 48000, { ...NO_FILTER, type: "lowpass", slope: 48 });
    n.forEach((node, i) => {
      expect(node.type).toBe("lowpass");
      expect(node.Q.value).toBeCloseTo(qToDb(butterworthQ(4, i + 1)));
    });
    const two = nodes();
    configureFilter(two, 48000, { ...NO_FILTER, type: "lowpass", slope: 24 });
    expect(two[1].type).toBe("lowpass");
    expect(two[2].type).toBe("peaking");
  });

  it("uses a linear Q from the bandwidth for a band-pass", () => {
    const n = nodes();
    configureFilter(n, 48000, { ...NO_FILTER, type: "bandpass", freq: 1000, bandwidth: 250 });
    expect(n[0].type).toBe("bandpass");
    expect(n[0].Q.value).toBeCloseTo(4);
    expect(n[1].type).toBe("peaking");
  });

  it("keeps the frequency inside what the context accepts", () => {
    const n = nodes();
    configureFilter(n, 48000, { ...NO_FILTER, type: "lowpass", freq: 99999 });
    expect(n[0].frequency.value).toBe(23999);
  });
});

describe("PreviewEngine", () => {
  it("decodes through the audio context and wakes it if it was suspended", async () => {
    const engine = new PreviewEngine();
    // Le contexte n'existe qu'au premier décodage.
    const buffer = await engine.decode(new ArrayBuffer(8));
    expect(buffer.duration).toBe(10);
    contexts[0].state = "suspended";
    await engine.decode(new ArrayBuffer(8));
    expect(contexts[0].resume).toHaveBeenCalled();
  });

  it("chains source → fades → four filter stages → normalise gain → analyser and output", async () => {
    const { ctx } = await loadedEngine();
    const [fade, normalize] = ctx.gains;
    expect(fade.connect).toHaveBeenCalledWith(ctx.biquads[0]);
    expect(ctx.biquads[3].connect).toHaveBeenCalledWith(normalize);
    expect(normalize.connect).toHaveBeenCalledWith(ctx.analyser);
    expect(normalize.connect).toHaveBeenCalledWith(ctx.destination);
  });

  it("is silent about a missing preview until a buffer is loaded", () => {
    const engine = new PreviewEngine();
    expect(engine.hasPreview).toBe(false);
    engine.play();
    expect(engine.playing).toBe(false);
    engine.seek(3);
    expect(engine.currentTime()).toBe(0);
  });

  it("plays from the start, with the source at the chosen speed", async () => {
    const { engine, ctx } = await loadedEngine({ speed: 2 });
    engine.play();
    expect(engine.playing).toBe(true);
    const source = ctx.sources[0];
    expect(source.start).toHaveBeenCalledWith(0, 0);
    expect(source.playbackRate.value).toBe(2);
  });

  it("counts the playhead in buffer time, so a faster speed moves it faster", async () => {
    const { engine, ctx } = await loadedEngine({ speed: 2 });
    engine.play();
    ctx.currentTime = 1.5;
    expect(engine.currentTime()).toBeCloseTo(3);
  });

  it("never reports a time past the end", async () => {
    const { engine, ctx } = await loadedEngine();
    engine.play();
    ctx.currentTime = 99;
    expect(engine.currentTime()).toBe(10);
  });

  it("pausing stops the source and keeps the position", async () => {
    const { engine, ctx } = await loadedEngine();
    engine.play();
    ctx.currentTime = 4;
    engine.pause();
    expect(engine.playing).toBe(false);
    expect(ctx.sources[0].stop).toHaveBeenCalled();
    expect(engine.currentTime()).toBeCloseTo(4);
    engine.play();
    expect(ctx.sources[1].start).toHaveBeenCalledWith(0, expect.closeTo(4));
  });

  it("seeks while paused, and restarts from the new place while playing", async () => {
    const { engine, ctx } = await loadedEngine();
    engine.seek(6);
    expect(engine.currentTime()).toBe(6);
    engine.play();
    engine.seek(2);
    expect(ctx.sources[1].start).toHaveBeenCalledWith(0, 2);
    engine.seek(500);
    expect(engine.currentTime()).toBe(10);
  });

  it("starts again from the beginning once the end was reached", async () => {
    const { engine, ctx } = await loadedEngine();
    engine.seek(10);
    engine.play();
    expect(ctx.sources[0].start).toHaveBeenCalledWith(0, 0);
  });

  it("goes back to the start and tells its owner when the sound ends", async () => {
    const { engine, ctx } = await loadedEngine();
    const ended = vi.fn();
    engine.setOnEnded(ended);
    engine.play();
    ctx.sources[0].onended?.();
    expect(ended).toHaveBeenCalled();
    expect(engine.playing).toBe(false);
    expect(engine.currentTime()).toBe(0);
  });

  it("automates the fade envelope on the audio clock", async () => {
    const { engine, ctx } = await loadedEngine({ fadeIn: 2, fadeOut: 2 });
    engine.play();
    const fade = ctx.gains[0].gain;
    expect(fade.events[0]).toEqual(["set", 0, 0]);
    const ramps = fade.events.filter(([kind]) => kind === "ramp");
    // Monte à 1 à t = 2 s, redescend à 0 à t = 10 s.
    expect(ramps).toContainEqual(["ramp", 1, 2]);
    expect(ramps[ramps.length - 1]).toEqual(["ramp", 0, 10]);
  });

  it("rebuilds what plays without the cuts, and tracks the shorter duration", async () => {
    const { engine, buffer } = await loadedEngine();
    (buffer as unknown as FakeBuffer).data[0].fill(0.5, 0, 48000);
    engine.setKept([
      { start: 0, end: 2 },
      { start: 5, end: 10 },
    ]);
    expect(engine.virtualDuration).toBe(7);
    engine.seek(3);
    // 3 s de ce qui reste = 1 s après le début du deuxième segment : 6 s du fichier.
    expect(engine.currentRealTime()).toBeCloseTo(6);
  });

  it("restarts the sound on the new cuts when it is playing", async () => {
    const { engine, ctx } = await loadedEngine();
    engine.play();
    engine.setKept([{ start: 0, end: 5 }]);
    expect(ctx.sources).toHaveLength(2);
    expect(ctx.sources[0].stop).toHaveBeenCalled();
  });

  it("re-anchors the playhead before changing the speed", async () => {
    const { engine, ctx } = await loadedEngine({ speed: 1 });
    engine.play();
    ctx.currentTime = 2;
    engine.setParams(params({ speed: 2 }));
    // Les 2 s jouées à vitesse normale restent 2 s ; ensuite ça va deux fois plus vite.
    expect(engine.currentTime()).toBeCloseTo(2);
    ctx.currentTime = 3;
    expect(engine.currentTime()).toBeCloseTo(4);
    expect(ctx.sources[0].playbackRate.value).toBe(2);
  });

  it("applies the filter settings to the live stages", async () => {
    const { engine, ctx } = await loadedEngine();
    engine.setParams(params({ filter: { ...NO_FILTER, type: "highpass", freq: 300 } }));
    expect(ctx.biquads[0].type).toBe("highpass");
    expect(ctx.biquads[0].frequency.value).toBe(300);
  });

  describe("normalisation", () => {
    it("scales the sound so the rendered peak lands on −1 dBFS", async () => {
      vi.useFakeTimers();
      const { engine, ctx } = await loadedEngine({ normalize: true });
      await vi.advanceTimersByTimeAsync(10);
      expect(ctx.gains[1].gain.value).toBeCloseTo(TARGET_PEAK / 0.25);
      engine.setParams(params({ normalize: false }));
      expect(ctx.gains[1].gain.value).toBe(1);
    });

    it("waits for a burst of changes to settle, and keeps only the last measurement", async () => {
      vi.useFakeTimers();
      const { engine, ctx } = await loadedEngine({ normalize: true });
      await vi.advanceTimersByTimeAsync(10);
      offlinePeak = 0.5;
      engine.setParams(params({ normalize: true, fadeIn: 1 }));
      engine.setParams(params({ normalize: true, fadeIn: 2 }));
      expect(ctx.gains[1].gain.value).toBeCloseTo(TARGET_PEAK / 0.25);
      await vi.advanceTimersByTimeAsync(200);
      expect(ctx.gains[1].gain.value).toBeCloseTo(TARGET_PEAK / 0.5);
    });

    it("leaves a silent file alone instead of dividing by zero", async () => {
      vi.useFakeTimers();
      offlinePeak = 0;
      const { ctx } = await loadedEngine({ normalize: true });
      await vi.advanceTimersByTimeAsync(10);
      expect(ctx.gains[1].gain.value).toBe(1);
    });

    it("falls back to the waveform's peak when offline rendering is unavailable", async () => {
      vi.useFakeTimers();
      vi.stubGlobal("OfflineAudioContext", undefined);
      const { ctx } = await loadedEngine({ normalize: true });
      await vi.advanceTimersByTimeAsync(10);
      // La forme d'onde [0.1, 0.5, 0.9] : pic 0,9.
      expect(ctx.gains[1].gain.value).toBeCloseTo(TARGET_PEAK / 0.9);
    });

    it("keeps unity gain when the measurement fails", async () => {
      vi.useFakeTimers();
      vi.stubGlobal(
        "OfflineAudioContext",
        class extends FakeOffline {
          startRendering = vi.fn().mockRejectedValue(new Error("boom"));
        },
      );
      const { ctx } = await loadedEngine({ normalize: true });
      await vi.advanceTimersByTimeAsync(10);
      expect(ctx.gains[1].gain.value).toBe(1);
    });
  });

  it("closes the audio context and stops the sound when disposed", async () => {
    const { engine, ctx } = await loadedEngine();
    engine.play();
    engine.dispose();
    expect(ctx.sources[0].stop).toHaveBeenCalled();
    expect(ctx.close).toHaveBeenCalled();
    expect(engine.playing).toBe(false);
  });
});
