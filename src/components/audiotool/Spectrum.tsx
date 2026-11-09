import { useEffect, useRef } from "react";

const BARS = 48;

const cssVar = (name: string, fallback: string) =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;

/** Barres de fréquences en direct, à partir du son qui arrive à la sortie ; une ligne plate de
 * petites barres quand rien ne joue. */
export default function Spectrum({ analyser, playing }: { analyser: AnalyserNode | null; playing: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const data = useRef<Uint8Array<ArrayBuffer> | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    let raf = 0;
    const draw = () => {
      const dpr = window.devicePixelRatio || 1;
      const W = canvas.clientWidth;
      const H = canvas.clientHeight;
      if (!W || !H) return;
      const pw = Math.round(W * dpr);
      const ph = Math.round(H * dpr);
      if (canvas.width !== pw || canvas.height !== ph) {
        canvas.width = pw;
        canvas.height = ph;
      }
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);

      let levels: number[] | null = null;
      if (analyser && playing) {
        const bins = (data.current ??= new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount)));
        analyser.getByteFrequencyData(bins);
        // Barres réparties sur une échelle logarithmique : le grave est là où se trouve le son.
        levels = Array.from({ length: BARS }, (_, i) => {
          const from = Math.floor(Math.pow(bins.length, i / BARS)) - 1;
          const to = Math.max(from + 1, Math.floor(Math.pow(bins.length, (i + 1) / BARS)) - 1);
          let peak = 0;
          for (let k = Math.max(0, from); k < Math.min(bins.length, to); k++) peak = Math.max(peak, bins[k]);
          return peak / 255;
        });
      }

      const gap = 4;
      const barW = Math.max(2, (W - gap * (BARS + 1)) / BARS);
      const base = H * 0.9;
      const gradient = ctx.createLinearGradient(0, base, 0, H * 0.1);
      gradient.addColorStop(0, cssVar("--accent", "#5c86ff"));
      gradient.addColorStop(1, cssVar("--accent-hover", "#7a9dff"));
      ctx.fillStyle = gradient;
      for (let i = 0; i < BARS; i++) {
        const level = levels ? levels[i] : 0;
        const h = Math.max(3, level * H * 0.8);
        ctx.fillRect(gap + i * (barW + gap), base - h, barW, h);
      }
      if (playing) raf = requestAnimationFrame(draw);
    };
    draw();
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(draw) : null;
    observer?.observe(canvas);
    return () => {
      cancelAnimationFrame(raf);
      observer?.disconnect();
    };
  }, [analyser, playing]);

  return <canvas ref={ref} aria-hidden="true" />;
}
