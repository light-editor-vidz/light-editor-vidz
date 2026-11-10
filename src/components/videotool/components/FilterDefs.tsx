// SVG filters the CSS `filter: url(#…)` entries of src/shared/filters.json point
// to. The colour casts are the per-channel gains measured on a mid-grey frame
// run through the matching ffmpeg filter (colortemperature 10000 / 4000, curves
// vintage), and the posterize steps are the 4 levels of the export's lutrgb.
export default function FilterDefs() {
  const matrix = (r: number, g: number, b: number) => `${r} 0 0 0 0  0 ${g} 0 0 0  0 0 ${b} 0 0  0 0 0 1 0`;
  const levels = "0.125 0.375 0.625 0.875";
  return (
    <svg width="0" height="0" aria-hidden="true" style={{ position: "absolute" }} focusable="false">
      <filter id="lcv-cold" colorInterpolationFilters="sRGB">
        <feColorMatrix type="matrix" values={matrix(0.79, 0.85, 1)} />
      </filter>
      <filter id="lcv-warm" colorInterpolationFilters="sRGB">
        <feColorMatrix type="matrix" values={matrix(1, 0.8, 0.65)} />
      </filter>
      <filter id="lcv-vintage" colorInterpolationFilters="sRGB">
        <feColorMatrix type="matrix" values={matrix(1.15, 0.96, 0.89)} />
      </filter>
      <filter id="lcv-posterize" colorInterpolationFilters="sRGB">
        <feComponentTransfer>
          <feFuncR type="discrete" tableValues={levels} />
          <feFuncG type="discrete" tableValues={levels} />
          <feFuncB type="discrete" tableValues={levels} />
        </feComponentTransfer>
      </filter>
    </svg>
  );
}
