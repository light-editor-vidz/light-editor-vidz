// Aperçu sonore de la vue Audio (Web Audio API), repris de LightCutSoundz.
//
// Graphe : source → fondus → étages de filtre → normalisation → sortie, dans l'ordre où le moteur
// Rust les applique (le `playbackRate` de la source tient lieu de changement de vitesse). Les
// filtres raides sont plusieurs biquads en série, comme dans le moteur ; les étages inutilisés
// sont des identités exactes.

import { keptDuration, realToVirtual, virtualToReal, type Segment } from "./cuts";
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
/** Fondu de chaque côté d'un raccord de coupe (le moteur Rust applique le même : 5 ms). */
const SPLICE_FADE_SECONDS = 0.005;
/** Durée rendue d'un bloc pour mesurer le pic, et amorce des filtres avant chaque bloc. */
const RENDER_CHUNK_SECONDS = 60;
const RENDER_PREROLL_SECONDS = 1;

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
  /** La dernière source planifiée : sa fin est celle de la lecture. */
  private source: AudioBufferSourceNode | null = null;
  /** Une source par segment conservé, toutes sur le même buffer décodé : les coupes ne recopient
   * jamais le PCM (un podcast de plusieurs heures en tient plusieurs Go). */
  private sources: AudioBufferSourceNode[] = [];
  /** Les gains de micro-fondu des raccords, déconnectés avec les sources. */
  private spliceGains: GainNode[] = [];

  private audioBuffer: AudioBuffer | null = null;
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
  /** Un rendu de mesure est en cours ; `normRerun` : un réglage est arrivé pendant ce temps. */
  private normRunning = false;
  private normRerun = false;
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
    this.duration = duration;
    this.waveform = waveform;
    this.kept = duration > 0 ? [{ start: 0, end: duration }] : [];
    this.startOffset = 0;
    this.setNormalizeGain(1);
    if (this.ctx) this.applyParams();
    this.scheduleNormalization(true);
  }

  /** L'aperçu décodé arrive après l'ouverture du fichier : l'éditeur n'attend pas le décodage. */
  setBuffer(buffer: AudioBuffer): void {
    this.audioBuffer = buffer;
    this.scheduleNormalization(true);
  }

  get hasPreview(): boolean {
    return this.audioBuffer !== null;
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
    const end = this.audioBuffer ? this.virtualDuration : 0;
    return Math.min(this.startOffset + (this.ctx.currentTime - this.startCtxTime) * this.rate, end);
  }

  /** Position dans le fichier d'origine (là où se trouve le son). */
  currentRealTime(): number {
    return virtualToReal(this.currentTime(), this.kept);
  }

  /** Les coupes ont changé : seuls les segments planifiés changent, le buffer reste le même. */
  setKept(kept: Segment[]): void {
    // La tête de lecture est un point du fichier : une coupe avant elle ne doit pas la faire sauter
    // de la longueur de la coupe. Elle est convertie en position du fichier avec les anciennes
    // coupes, puis retraduite avec les nouvelles.
    const real = this.audioBuffer ? this.currentRealTime() : 0;
    const before = this.playing ? this.currentTime() : this.startOffset;
    this.kept = kept;
    this.startOffset = this.audioBuffer ? realToVirtual(real, kept) : before;
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
      end: this.virtualDuration,
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
      this.rate = rate;
      if (this.sources.length > 1) {
        // Les segments suivants sont planifiés pour l'ancienne vitesse : on repart d'ici.
        this.start(this.startOffset);
        return;
      }
      this.source.playbackRate.value = rate;
      this.rescheduleFades();
    }
    this.rate = rate;
  }

  private start(offset: number): void {
    if (!this.ctx || !this.audioBuffer || !this.fadeGain) return;
    this.stopSource();
    const ctx = this.ctx;
    const total = this.virtualDuration;
    this.startOffset = Math.max(0, Math.min(offset, total));
    this.startCtxTime = ctx.currentTime;
    this.rate = validRate(this.params.speed);
    configureFilter(this.filters, ctx.sampleRate, this.params.filter);
    this.scheduleFades(this.fadeGain.gain, ctx.currentTime, this.startOffset, this.rate);
    let at = 0; // début du segment, compté le long de ce que les coupes laissent
    for (const [index, { start, end }] of this.kept.entries()) {
      const length = end - start;
      const skip = Math.max(0, this.startOffset - at);
      if (at + length > this.startOffset) {
        const source = ctx.createBufferSource();
        source.buffer = this.audioBuffer;
        source.playbackRate.value = this.rate;
        // Le premier segment part tout de suite ; les suivants à l'heure où la lecture les atteint.
        const when = this.sources.length === 0 ? 0 : this.startCtxTime + (at - this.startOffset) / this.rate;
        const startsAt = Math.max(when, ctx.currentTime);
        const isJoinBefore = at > 0 && skip === 0;
        const isJoinAfter = index < this.kept.length - 1;
        if (isJoinBefore || isJoinAfter) {
          // Micro-fondu de part et d'autre de chaque raccord (comme l'export) : sans lui, deux
          // morceaux recollés à une phase quelconque claquent.
          const gain = ctx.createGain();
          const edge = SPLICE_FADE_SECONDS;
          const playSeconds = (length - skip) / this.rate;
          gain.gain.setValueAtTime(isJoinBefore ? 0 : 1, startsAt);
          if (isJoinBefore) gain.gain.linearRampToValueAtTime(1, startsAt + edge);
          if (isJoinAfter && playSeconds > 2 * edge) {
            gain.gain.setValueAtTime(1, startsAt + playSeconds - edge);
            gain.gain.linearRampToValueAtTime(0, startsAt + playSeconds);
          }
          source.connect(gain);
          gain.connect(this.fadeGain);
          this.spliceGains.push(gain);
        } else {
          source.connect(this.fadeGain);
        }
        if (end >= this.duration) source.start(when, start + skip);
        else source.start(when, start + skip, length - skip);
        this.sources.push(source);
      }
      at += length;
    }
    const last = this.sources[this.sources.length - 1];
    if (!last) return;
    this.source = last;
    last.onended = () => {
      this.stopSource();
      this.startOffset = 0;
      this.onEnded();
    };
  }

  private stopSource(): void {
    const sources = this.sources;
    this.sources = [];
    for (const gain of this.spliceGains) gain.disconnect();
    this.spliceGains = [];
    if (sources.length === 0 || !this.ctx) {
      this.source = null;
      return;
    }
    this.startOffset = this.currentTime();
    for (const source of sources) {
      source.onended = null;
      try {
        source.stop();
      } catch {
        // Déjà arrêtée.
      }
      source.disconnect();
    }
    this.source = null;
    this.fadeGain?.gain.cancelScheduledValues(this.ctx.currentTime);
  }

  play(): void {
    if (!this.audioBuffer) return;
    // Depuis le début une fois la fin atteinte.
    const from = this.startOffset >= this.virtualDuration - 0.01 ? 0 : this.startOffset;
    this.start(from);
  }

  pause(): void {
    this.stopSource();
  }

  /** Déplace la tête de lecture à `time`, compté le long de ce que les coupes laissent. */
  seek(time: number): void {
    if (!this.audioBuffer) return;
    const wasPlaying = this.playing;
    if (wasPlaying) this.stopSource();
    this.startOffset = Math.max(0, Math.min(time, this.virtualDuration));
    if (wasPlaying) this.start(this.startOffset);
  }

  // ─── Normalisation de l'aperçu ─────────────────────────────────────────────

  private setNormalizeGain(gain: number): void {
    if (this.normalizeGain) this.normalizeGain.gain.value = gain;
  }

  /** Pic de la région conservée une fois fondus et filtre appliqués, rendu hors ligne par tranches
   * (une heure de son rendue d'un bloc ferait un buffer de plusieurs centaines de Mo). Chaque
   * tranche a une courte amorce pour que les filtres soient établis, et n'est mesurée qu'après. */
  private async renderedPeak(): Promise<number> {
    const buffer = this.audioBuffer;
    if (!buffer) return 0;
    const region = this.region();
    const end = region.end ?? 0;
    let peak = 0;
    for (let from = 0; from < end; from += RENDER_CHUNK_SECONDS) {
      const preroll = Math.min(RENDER_PREROLL_SECONDS, from);
      peak = Math.max(
        peak,
        await this.renderWindow(buffer, region, from, Math.min(end, from + RENDER_CHUNK_SECONDS), preroll),
      );
    }
    return peak;
  }

  /** Rend la fenêtre `[from, to]` (temps de ce qui reste après les coupes) et renvoie son pic. */
  private async renderWindow(
    buffer: AudioBuffer,
    region: FadeRegion,
    from: number,
    to: number,
    preroll: number,
  ): Promise<number> {
    const rate = buffer.sampleRate;
    const origin = from - preroll;
    const length = Math.max(1, Math.ceil((to - origin) * rate));
    const offline = new OfflineAudioContext(buffer.numberOfChannels, length, rate);
    const fades = offline.createGain();
    const filters = Array.from({ length: FILTER_STAGES }, () => offline.createBiquadFilter());
    let previous: AudioNode = fades;
    for (const node of filters) {
      previous.connect(node);
      previous = node;
    }
    previous.connect(offline.destination);
    configureFilter(filters, rate, this.params.filter);
    this.scheduleFades(fades.gain, 0, origin, 1, region);
    let at = 0;
    for (const { start, end } of this.kept) {
      const segEnd = at + (end - start);
      const lo = Math.max(at, origin);
      const hi = Math.min(segEnd, to);
      if (hi > lo) {
        const source = offline.createBufferSource();
        source.buffer = buffer;
        source.connect(fades);
        source.start(lo - origin, start + (lo - at), hi - lo);
      }
      at = segEnd;
    }
    const rendered = await offline.startRendering();
    let peak = 0;
    const first = Math.min(rendered.length, Math.ceil(preroll * rate));
    for (let ch = 0; ch < rendered.numberOfChannels; ch++) {
      const data = rendered.getChannelData(ch);
      for (let i = first; i < data.length; i++) {
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
    // Un rendu hors ligne est déjà en cours : on n'en empile pas un second (chaque réglage lançait
    // le sien, tous en parallèle). Le dernier état demandé est mesuré une fois celui-ci terminé.
    if (this.normRunning) {
      this.normRerun = true;
      return;
    }
    const token = ++this.normToken;
    if (!this.audioBuffer || !this.params.normalize) {
      this.setNormalizeGain(1);
      return;
    }
    this.normRunning = true;
    try {
      const peak = await this.regionPeak();
      if (token === this.normToken) this.setNormalizeGain(peak > 1e-8 ? TARGET_PEAK / peak : 1);
    } catch {
      if (token === this.normToken) this.setNormalizeGain(1);
    } finally {
      this.normRunning = false;
      if (this.normRerun) {
        this.normRerun = false;
        void this.updateNormalization();
      }
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
