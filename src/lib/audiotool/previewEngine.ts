// Aperçu sonore de la vue Audio (Web Audio API), repris de LightCutSoundz.
//
// Graphe : source → fondus → étages de filtre → normalisation → sortie, dans l'ordre où le moteur
// Rust les applique (le `playbackRate` de la source tient lieu de changement de vitesse). Les
// filtres raides sont plusieurs biquads en série, comme dans le moteur ; les étages inutilisés
// sont des identités exactes.

import { keptDuration, virtualToReal, type Segment } from "./cuts";
import {
  TARGET_PEAK,
  DEFAULT_Q,
  bandpassQ,
  butterworthQ,
  clampFilterFreq,
  fadeEnvelopePoints,
  qToDb,
  waveformPeak,
  type FadeRegion,
  type FilterType,
} from "./helpers";

/** L'étage le plus raide : quatre biquads de 12 dB/octave en série. */
const FILTER_STAGES = 4;
const NORMALIZE_DEBOUNCE_MS = 150;

export interface FilterParams {
  type: FilterType | string;
  freq: number;
  /** Pente en dB/octave (12 pour un passe-bande, qui n'en a pas). */
  slope: number;
  q: number;
  bandwidth: number;
}

export interface PreviewParams {
  fadeIn: number;
  fadeOut: number;
  curve: string;
  speed: number;
  normalize: boolean;
  filter: FilterParams;
}

const validRate = (rate: number) => (Number.isFinite(rate) && rate > 0 ? rate : 1.0);

/** Le Q affiché vaut 0,707 arrondi ; le moteur n'est informé que d'un Q qui s'en écarte, donc
 * l'aperçu traite la valeur arrondie comme celle par défaut. */
function effectiveQ(q: number): number {
  if (!Number.isFinite(q) || q <= 0 || Math.abs(q - DEFAULT_Q) <= 1e-3) return DEFAULT_Q;
  return q;
}

/** Règle des étages de filtre (en direct ou hors ligne) d'après les réglages. */
export function configureFilter(nodes: BiquadFilterNode[], sampleRate: number, filter: FilterParams): void {
  const type = filter.type;
  const freq = clampFilterFreq(filter.freq || 1000, sampleRate);
  const stages = type === "" ? 0 : type === "bandpass" ? 1 : Math.max(1, Math.round(filter.slope / 12));
  nodes.forEach((node, i) => {
    if (i >= stages) {
      // Un filtre en cloche sans gain ne change rien du tout.
      node.type = "peaking";
      node.gain.value = 0;
      return;
    }
    node.type = type as BiquadFilterType;
    node.frequency.value = freq;
    if (type === "bandpass") {
      // Q linéaire.
      node.Q.value = bandpassQ(freq, filter.bandwidth || 500);
    } else {
      // Le Q des passe-bas et passe-haut est en décibels dans Web Audio.
      const q = stages === 1 ? effectiveQ(filter.q) : butterworthQ(stages, i + 1);
      node.Q.value = qToDb(q);
    }
  });
}

export class PreviewEngine {
  private ctx: AudioContext | null = null;
  private fadeGain: GainNode | null = null;
  private filters: BiquadFilterNode[] = [];
  private normalizeGain: GainNode | null = null;
  private analyser: AnalyserNode | null = null;
  private source: AudioBufferSourceNode | null = null;

  private audioBuffer: AudioBuffer | null = null;
  /** `audioBuffer` sans les coupes. */
  private playBuffer: AudioBuffer | null = null;
  private kept: Segment[] = [];
  private params: PreviewParams = {
    fadeIn: 0,
    fadeOut: 0,
    curve: "linear",
    speed: 1,
    normalize: false,
    filter: { type: "", freq: 1000, slope: 12, q: DEFAULT_Q, bandwidth: 500 },
  };
  private waveform: ArrayLike<number> | null = null;
  private duration = 0;

  private startCtxTime = 0;
  private startOffset = 0;
  private rate = 1;
  private normToken = 0;
  private normTimer: ReturnType<typeof setTimeout> | null = null;

  private onEnded: () => void = () => {};

  /** Appelé quand la lecture arrive au bout. */
  setOnEnded(callback: () => void): void {
    this.onEnded = callback;
  }

  private ensureContext(): AudioContext {
    if (this.ctx) return this.ctx;
    const ctx = new AudioContext();
    this.ctx = ctx;
    this.fadeGain = ctx.createGain();
    this.normalizeGain = ctx.createGain();
    this.filters = Array.from({ length: FILTER_STAGES }, () => ctx.createBiquadFilter());
    let previous: AudioNode = this.fadeGain;
    for (const node of this.filters) {
      previous.connect(node);
      previous = node;
    }
    previous.connect(this.normalizeGain);
    // N'écoute que pour la visualisation ; le son va à la sortie.
    this.analyser = ctx.createAnalyser?.() ?? null;
    if (this.analyser) {
      this.analyser.fftSize = 512;
      this.analyser.smoothingTimeConstant = 0.8;
      this.normalizeGain.connect(this.analyser);
    }
    this.normalizeGain.connect(ctx.destination);
    return ctx;
  }

  /** Décode le fichier pour l'aperçu. L'aperçu est facultatif : une WebView sans le codec voulu ne
   * doit pas empêcher d'ouvrir et d'exporter le fichier. */
  async decode(data: ArrayBuffer): Promise<AudioBuffer> {
    const ctx = this.ensureContext();
    if (ctx.state === "suspended") await ctx.resume();
    return ctx.decodeAudioData(data);
  }

  /** Nouveau fichier : tout repart de zéro. */
  load(buffer: AudioBuffer | null, duration: number, waveform: ArrayLike<number> | null): void {
    this.stopSource();
    this.audioBuffer = buffer;
    this.playBuffer = buffer;
    this.duration = duration;
    this.waveform = waveform;
    this.kept = duration > 0 ? [{ start: 0, end: duration }] : [];
    this.startOffset = 0;
    this.setNormalizeGain(1);
    if (this.ctx) this.applyParams();
    this.scheduleNormalization(true);
  }

  get hasPreview(): boolean {
    return this.playBuffer !== null;
  }

  /** Durée de ce que les coupes laissent. */
  get virtualDuration(): number {
    return keptDuration(this.kept);
  }

  get analyserNode(): AnalyserNode | null {
    return this.analyser;
  }

  get playing(): boolean {
    return this.source !== null;
  }

  /** Position (secondes de ce qui reste après les coupes). */
  currentTime(): number {
    if (!this.ctx || !this.source) return this.startOffset;
    // Le temps du contexte est celui de l'horloge murale ; la source consomme le buffer `rate`
    // fois plus vite, donc la tête de lecture doit suivre.
    const end = this.playBuffer?.duration ?? 0;
    return Math.min(this.startOffset + (this.ctx.currentTime - this.startCtxTime) * this.rate, end);
  }

  /** Position dans le fichier d'origine (là où se trouve le son). */
  currentRealTime(): number {
    return virtualToReal(this.currentTime(), this.kept);
  }

  /** Les coupes ont changé : le buffer lu est reconstruit (une fois par édition). */
  setKept(kept: Segment[]): void {
    this.kept = kept;
    const buffer = this.audioBuffer;
    if (!buffer || !this.ctx) {
      this.playBuffer = buffer;
    } else if (kept.length === 1 && kept[0].start === 0 && kept[0].end >= this.duration) {
      this.playBuffer = buffer;
    } else {
      const rate = buffer.sampleRate;
      const segments = kept.map(({ start, end }): [number, number] => [
        Math.round(start * rate),
        Math.round(end * rate),
      ]);
      const length = Math.max(
        1,
        segments.reduce((sum, [a, b]) => sum + Math.max(0, b - a), 0),
      );
      const out = this.ctx.createBuffer(buffer.numberOfChannels, length, rate);
      for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
        const from = buffer.getChannelData(ch);
        const to = out.getChannelData(ch);
        let at = 0;
        for (const [a, b] of segments) {
          to.set(from.subarray(a, b), at);
          at += Math.max(0, b - a);
        }
      }
      this.playBuffer = out;
    }
    this.startOffset = Math.min(this.startOffset, this.virtualDuration);
    this.scheduleNormalization();
    if (this.playing) this.start(this.currentTime());
  }

  setParams(params: PreviewParams): void {
    const speedChanged = params.speed !== this.params.speed;
    this.params = params;
    if (!this.ctx) return;
    if (speedChanged) this.setRate(params.speed);
    configureFilter(this.filters, this.ctx.sampleRate, params.filter);
    this.rescheduleFades();
    this.scheduleNormalization();
  }

  private applyParams(): void {
    if (!this.ctx) return;
    this.setRate(this.params.speed);
    configureFilter(this.filters, this.ctx.sampleRate, this.params.filter);
  }

  private region(): FadeRegion {
    return {
      start: 0,
      end: this.playBuffer?.duration ?? this.virtualDuration,
      fadeIn: this.params.fadeIn || 0,
      fadeOut: this.params.fadeOut || 0,
      curve: this.params.curve,
    };
  }

  /** Automatise le gain des fondus sur l'horloge audio, à partir du temps de buffer `from` : reste
   * juste fenêtre masquée et sans bruit de zipper. */
  private scheduleFades(param: AudioParam, now: number, from: number, rate: number, region = this.region()): void {
    const [first, ...rest] = fadeEnvelopePoints(region, from);
    param.cancelScheduledValues(now);
    param.setValueAtTime(first[1], now);
    for (const [time, gain] of rest) param.linearRampToValueAtTime(gain, now + (time - from) / rate);
  }

  private rescheduleFades(): void {
    if (!this.ctx || !this.source || !this.fadeGain) return;
    this.scheduleFades(this.fadeGain.gain, this.ctx.currentTime, this.currentTime(), this.rate);
  }

  /** Ré-ancre la timeline avant de changer de vitesse : le temps écoulé garde la vitesse à
   * laquelle il a été joué. */
  private setRate(rate: number): void {
    rate = validRate(rate);
    if (this.ctx && this.source) {
      this.startOffset = this.currentTime();
      this.startCtxTime = this.ctx.currentTime;
      this.source.playbackRate.value = rate;
      this.rate = rate;
      this.rescheduleFades();
    }
    this.rate = rate;
  }

  private start(offset: number): void {
    if (!this.ctx || !this.playBuffer || !this.fadeGain) return;
    this.stopSource();
    const source = this.ctx.createBufferSource();
    this.source = source;
    source.buffer = this.playBuffer;
    source.connect(this.fadeGain);
    this.startOffset = Math.max(0, Math.min(offset, this.playBuffer.duration));
    this.startCtxTime = this.ctx.currentTime;
    this.rate = validRate(this.params.speed);
    source.playbackRate.value = this.rate;
    configureFilter(this.filters, this.ctx.sampleRate, this.params.filter);
    this.scheduleFades(this.fadeGain.gain, this.ctx.currentTime, this.startOffset, this.rate);
    source.start(0, this.startOffset);
    source.onended = () => {
      this.source = null;
      this.startOffset = 0;
      this.onEnded();
    };
  }

  private stopSource(): void {
    const source = this.source;
    if (!source || !this.ctx) {
      this.source = null;
      return;
    }
    this.startOffset = this.currentTime();
    source.onended = null;
    try {
      source.stop();
    } catch {
      // Déjà arrêtée.
    }
    source.disconnect();
    this.source = null;
    this.fadeGain?.gain.cancelScheduledValues(this.ctx.currentTime);
  }

  play(): void {
    if (!this.playBuffer) return;
    // Depuis le début une fois la fin atteinte.
    const from = this.startOffset >= this.virtualDuration - 0.01 ? 0 : this.startOffset;
    this.start(from);
  }

  pause(): void {
    this.stopSource();
  }

  /** Déplace la tête de lecture à `time`, compté le long de ce que les coupes laissent. */
  seek(time: number): void {
    if (!this.playBuffer) return;
    const wasPlaying = this.playing;
    if (wasPlaying) this.stopSource();
    this.startOffset = Math.max(0, Math.min(time, this.virtualDuration));
    if (wasPlaying) this.start(this.startOffset);
  }

  // ─── Normalisation de l'aperçu ─────────────────────────────────────────────

  private setNormalizeGain(gain: number): void {
    if (this.normalizeGain) this.normalizeGain.gain.value = gain;
  }

  /** Pic de la région conservée une fois fondus et filtre appliqués, rendu hors ligne. */
  private async renderedPeak(): Promise<number> {
    const buffer = this.playBuffer;
    if (!buffer) return 0;
    const region = this.region();
    const end = region.end ?? 0;
    const rate = buffer.sampleRate;
    const length = Math.max(1, Math.ceil(end * rate));
    const offline = new OfflineAudioContext(buffer.numberOfChannels, length, rate);
    const source = offline.createBufferSource();
    const fades = offline.createGain();
    const filters = Array.from({ length: FILTER_STAGES }, () => offline.createBiquadFilter());
    source.buffer = buffer;
    source.connect(fades);
    let previous: AudioNode = fades;
    for (const node of filters) {
      previous.connect(node);
      previous = node;
    }
    previous.connect(offline.destination);
    configureFilter(filters, rate, this.params.filter);
    this.scheduleFades(fades.gain, 0, 0, 1, region);
    source.start(0, 0, end);
    const rendered = await offline.startRendering();
    let peak = 0;
    for (let ch = 0; ch < rendered.numberOfChannels; ch++) {
      const data = rendered.getChannelData(ch);
      for (let i = 0; i < data.length; i++) {
        const a = Math.abs(data[i]);
        if (a > peak) peak = a;
      }
    }
    return peak;
  }

  private async regionPeak(): Promise<number> {
    if (typeof OfflineAudioContext === "function") return this.renderedPeak();
    // Pas de rendu hors ligne : le pic de la forme d'onde sur la région, fondus et filtre ignorés.
    return Math.max(0, ...this.kept.map(({ start, end }) => waveformPeak(this.waveform, this.duration, start, end)));
  }

  private async updateNormalization(): Promise<void> {
    if (this.normTimer) clearTimeout(this.normTimer);
    this.normTimer = null;
    const token = ++this.normToken;
    if (!this.playBuffer || !this.params.normalize) {
      this.setNormalizeGain(1);
      return;
    }
    try {
      const peak = await this.regionPeak();
      if (token !== this.normToken) return;
      this.setNormalizeGain(peak > 1e-8 ? TARGET_PEAK / peak : 1);
    } catch {
      if (token === this.normToken) this.setNormalizeGain(1);
    }
  }

  /** Différé : curseurs et champs numériques émettent des rafales d'événements. Décocher la
   * normalisation rend tout de suite son gain à 1 et annule la mesure en cours. */
  private scheduleNormalization(immediate = false): void {
    if (this.normTimer) clearTimeout(this.normTimer);
    this.normTimer = null;
    if (!this.params.normalize) {
      this.normToken++;
      this.setNormalizeGain(1);
      return;
    }
    this.normTimer = setTimeout(() => void this.updateNormalization(), immediate ? 0 : NORMALIZE_DEBOUNCE_MS);
  }

  /** Libère le contexte audio (fermeture de l'onglet). */
  dispose(): void {
    this.stopSource();
    if (this.normTimer) clearTimeout(this.normTimer);
    this.normTimer = null;
    this.normToken++;
    void this.ctx?.close().catch(() => {});
    this.ctx = null;
  }
}
