import constants from "../shared/constants.json";

/** Extensions the app accepts (shared with the main process's open dialog). */
export const VIDEO_EXTENSIONS: string[] = constants.videoExtensions;

/**
 * Judged on the extension, not `File.type`: the MIME type is empty for MKV/FLV
 * on several platforms, which made valid drops vanish silently.
 */
export function isVideoFileName(name: string): boolean {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return name.includes(".") && VIDEO_EXTENSIONS.includes(ext);
}

type Point = [number, number];
type Matrix3 = number[][];

const mul = (a: Matrix3, b: Matrix3): Matrix3 =>
  a.map((_, i) => b[0].map((__, j) => a[i][0] * b[0][j] + a[i][1] * b[1][j] + a[i][2] * b[2][j]));

/** The 3x3 projective map taking the four `from` points to the four `to` points. */
export function homography(from: Point[], to: Point[]): Matrix3 {
  // 8 unknowns (h33 = 1), solved by Gaussian elimination with partial pivoting.
  const rows: number[][] = [];
  for (let k = 0; k < 4; k++) {
    const [x, y] = from[k];
    const [u, v] = to[k];
    rows.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u]);
    rows.push([0, 0, 0, x, y, 1, -v * x, -v * y, v]);
  }
  for (let col = 0; col < 8; col++) {
    let pivot = col;
    for (let r = col + 1; r < 8; r++) if (Math.abs(rows[r][col]) > Math.abs(rows[pivot][col])) pivot = r;
    [rows[col], rows[pivot]] = [rows[pivot], rows[col]];
    for (let r = 0; r < 8; r++) {
      if (r === col) continue;
      const factor = rows[r][col] / rows[col][col];
      for (let c = col; c < 9; c++) rows[r][c] -= factor * rows[col][c];
    }
  }
  const h = rows.map((row, i) => row[8] / row[i]);
  return [
    [h[0], h[1], h[2]],
    [h[3], h[4], h[5]],
    [h[6], h[7], 1],
  ];
}

const rotationAbout = (deg: number, cx: number, cy: number): Matrix3 => {
  const t = (deg * Math.PI) / 180;
  const cos = Math.cos(t);
  const sin = Math.sin(t);
  return [
    [cos, -sin, cx - cos * cx + sin * cy],
    [sin, cos, cy - sin * cx - cos * cy],
    [0, 0, 1],
  ];
};

/**
 * Where the export's perspective filter (`perspective=…:sense=destination`)
 * sends the four corners of the picture (top-left, top-right, bottom-left,
 * bottom-right). Same corner formula as src/main/lib/videoFilters.js; checked
 * against real ffmpeg renders in ffmpeg.integration.test.js.
 */
export function perspectiveCorners(w: number, h: number, perspectiveH: number, perspectiveV: number): Point[] {
  const sh = Math.sin((perspectiveH * Math.PI) / 180) * 0.2;
  const sv = Math.sin((perspectiveV * Math.PI) / 180) * 0.2;
  return [
    [-w * sv, -h * sh],
    [w + w * sv, h * sh],
    [w * sv, h + h * sh],
    [w - w * sv, h - h * sh],
  ];
}

/** CSS `matrix3d()` for a 3x3 projective matrix acting on element pixels. */
const toMatrix3d = (m: Matrix3) =>
  `matrix3d(${[m[0][0], m[1][0], 0, m[2][0], m[0][1], m[1][1], 0, m[2][1], 0, 0, 1, 0, m[0][2], m[1][2], 0, m[2][2]].join(",")})`;

/**
 * CSS transform that mirrors the export's geometry for the live preview, in the
 * export's own order: rotation (+ straighten), then perspective, then the
 * mirror/flip colour filters. Perspective needs the element's pixel size; with
 * no perspective, plain rotate/scale keywords are enough.
 */
export function videoTransform(
  rotation: number,
  straighten: number,
  perspectiveH: number,
  perspectiveV: number,
  filterId: string,
  size?: { w: number; h: number },
): string {
  const flipX = filterId === "mirror";
  const flipY = filterId === "upside_down";

  if ((perspectiveH !== 0 || perspectiveV !== 0) && size && size.w > 0 && size.h > 0) {
    const { w, h } = size;
    const corners = perspectiveCorners(w, h, perspectiveH, perspectiveV);
    const persp = homography(
      [
        [0, 0],
        [w, 0],
        [0, h],
        [w, h],
      ],
      corners,
    );
    let m = mul(persp, rotationAbout(rotation + straighten, w / 2, h / 2));
    if (flipX)
      m = mul(
        [
          [-1, 0, w],
          [0, 1, 0],
          [0, 0, 1],
        ],
        m,
      );
    if (flipY)
      m = mul(
        [
          [1, 0, 0],
          [0, -1, h],
          [0, 0, 1],
        ],
        m,
      );
    return toMatrix3d(m);
  }

  return [`rotateZ(${rotation + straighten}deg)`, flipX ? "scaleX(-1)" : "", flipY ? "scaleY(-1)" : ""]
    .filter(Boolean)
    .join(" ");
}
