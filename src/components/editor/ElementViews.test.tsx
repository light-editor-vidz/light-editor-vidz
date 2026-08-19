import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { acquireMediaObjectUrl } from "../../lib/mediaCache";
import { TextElementView, ImageElementView, VideoElementView } from "./ElementViews";
import type { Element } from "../../bindings/Element";

vi.mock("../../lib/assetUrl", () => ({
  assetUrl: (dir: string, rel: string) => `asset://${dir}/${rel}`,
}));
vi.mock("../../lib/mediaCache", () => ({ acquireMediaObjectUrl: vi.fn() }));

const mockAcquire = vi.mocked(acquireMediaObjectUrl);

type TextEl = Extract<Element, { type: "text" }>;
type ImageEl = Extract<Element, { type: "image" }>;
type VideoEl = Extract<Element, { type: "video" }>;

const text = (over: Partial<TextEl> = {}): TextEl =>
  ({
    type: "text",
    id: "t1",
    name: "title",
    color: "#ffffff",
    alignment: "center",
    vertical_alignment: "center",
    ...over,
  }) as TextEl;

const image = (over: Partial<ImageEl> = {}): ImageEl =>
  ({ type: "image", id: "i1", name: "photo", src: "assets/images/a.png", ...over }) as ImageEl;

const video = (over: Partial<VideoEl> = {}): VideoEl =>
  ({
    type: "video",
    id: "v1",
    name: "clip",
    src: "assets/videos/a.mp4",
    start_time: 0,
    video_offset: 0,
    playback_speed: 1,
    volume: 1,
    muted: false,
    loop_video: false,
    ...over,
  }) as VideoEl;

beforeEach(() => {
  vi.clearAllMocks();
  mockAcquire.mockReturnValue({
    promise: Promise.resolve("blob:fake"),
    release: vi.fn(),
  } as never);
});

describe("TextElementView", () => {
  function draw(over: Partial<TextEl> = {}, content = "Hello") {
    const { container } = render(<TextElementView element={text(over)} content={content} />);
    return container.firstElementChild as HTMLElement;
  }

  it("renders the content", () => {
    draw({}, "Hello world");
    expect(screen.getByText("Hello world")).toBeInTheDocument();
  });

  it.each([
    ["top", "flex-start"],
    ["bottom", "flex-end"],
    ["center", "center"],
  ])("aligns %s vertically as %s", (vertical, expected) => {
    expect(draw({ vertical_alignment: vertical } as Partial<TextEl>)).toHaveStyle({
      alignItems: expected,
    });
  });

  it.each([
    ["left", "flex-start"],
    ["right", "flex-end"],
    ["center", "center"],
  ])("aligns %s horizontally as %s", (alignment, expected) => {
    expect(draw({ alignment } as Partial<TextEl>)).toHaveStyle({ justifyContent: expected });
  });

  it("applies the colour and background", () => {
    const el = draw({ color: "rgb(255, 0, 0)", background_color: "rgb(0, 0, 255)" } as Partial<TextEl>);
    expect(el).toHaveStyle({ color: "rgb(255, 0, 0)", background: "rgb(0, 0, 255)" });
  });

  it("defaults the font size to 4cqw", () => {
    expect(draw()).toHaveStyle({ fontSize: "4cqw" });
  });

  it("uses the configured font size", () => {
    expect(draw({ font_size: 8 } as Partial<TextEl>)).toHaveStyle({ fontSize: "8cqw" });
  });

  it("renders bold as weight 800 and anything else as 500", () => {
    expect(draw({ font_weight: "bold" } as Partial<TextEl>)).toHaveStyle({ fontWeight: "800" });
    expect(draw({ font_weight: "normal" } as Partial<TextEl>)).toHaveStyle({ fontWeight: "500" });
  });

  it("turns a letter spacing into cqw units", () => {
    expect(draw({ letter_spacing: 2 } as Partial<TextEl>)).toHaveStyle({ letterSpacing: "2cqw" });
  });

  it("builds a text shadow from its colour", () => {
    expect(draw({ text_shadow: "rgb(0, 0, 0)" } as Partial<TextEl>)).toHaveStyle({
      textShadow: "2px 2px 4px rgb(0, 0, 0)",
    });
  });

  it.each([
    [{ underline: true }, "underline"],
    [{ strikethrough: true }, "line-through"],
    [{ underline: true, strikethrough: true }, "underline line-through"],
  ])("decorates %j as %s", (over, expected) => {
    expect(draw(over as Partial<TextEl>)).toHaveStyle({ textDecoration: expected });
  });

  it("leaves the text undecorated by default", () => {
    expect(draw().style.textDecoration).toBe("");
  });
});

describe("ImageElementView", () => {
  function draw(over: Partial<ImageEl> = {}, panTransform = "") {
    const { container } = render(
      <ImageElementView element={image(over)} projectDir="/p" panTransform={panTransform} />,
    );
    return {
      wrapper: container.firstElementChild as HTMLElement,
      img: container.querySelector("img") as HTMLImageElement,
    };
  }

  it("points at the asset URL and uses the name as alt text", () => {
    const { img } = draw();
    expect(img).toHaveAttribute("src", "asset:///p/assets/images/a.png");
    expect(img).toHaveAttribute("alt", "photo");
  });

  it.each([
    ["stretch", "fill"],
    ["cover", "cover"],
    ["contain", "contain"],
    [undefined, "contain"],
  ])("maps fit mode %s to object-fit %s", (fitMode, expected) => {
    const { img } = draw({ fit_mode: fitMode } as Partial<ImageEl>);
    expect(img).toHaveStyle({ objectFit: expected });
  });

  it("rounds the corners when asked", () => {
    expect(draw({ corner_radius: 12 } as Partial<ImageEl>).wrapper).toHaveStyle({
      borderRadius: "12px",
    });
  });

  it("draws a border with its default width", () => {
    expect(draw({ border_color: "rgb(255, 0, 0)" } as Partial<ImageEl>).wrapper).toHaveStyle({
      border: "2px solid rgb(255, 0, 0)",
    });
  });

  it("honours an explicit border width", () => {
    expect(draw({ border_color: "rgb(0, 0, 0)", border_width: 5 } as Partial<ImageEl>).wrapper).toHaveStyle({
      border: "5px solid rgb(0, 0, 0)",
    });
  });

  it("applies the pan transform when there is one", () => {
    expect(draw({}, "scale(1.2)").img).toHaveStyle({ transform: "scale(1.2)" });
  });

  it("leaves the transform alone when the pan is empty", () => {
    expect(draw().img.style.transform).toBe("");
  });
});

describe("VideoElementView", () => {
  function draw(over: Partial<VideoEl> = {}, props: Record<string, unknown> = {}) {
    const { container } = render(
      <VideoElementView
        element={video(over)}
        projectDir="/p"
        localTime={0}
        playing={false}
        panTransform=""
        {...props}
      />,
    );
    return { container, video: container.querySelector("video") as HTMLVideoElement };
  }

  it("loads the media through the cache rather than asset://", async () => {
    draw();
    await waitFor(() => expect(mockAcquire).toHaveBeenCalledWith("/p", "assets/videos/a.mp4"));
  });

  it("plays from a blob URL once the bytes arrive", async () => {
    const { container } = draw();
    await act(async () => {});
    expect(container.querySelector("video")).toHaveAttribute("src", "blob:fake");
  });

  it("releases the media when unmounted", async () => {
    const release = vi.fn();
    mockAcquire.mockReturnValue({ promise: Promise.resolve("blob:fake"), release } as never);
    const { unmount } = render(
      <VideoElementView element={video()} projectDir="/p" localTime={0} playing={false} panTransform="" />,
    );
    await act(async () => {});

    unmount();

    expect(release).toHaveBeenCalled();
  });

  it("reports a playback error to the user", async () => {
    const { video: el } = draw();
    await act(async () => {});

    Object.defineProperty(el, "error", {
      value: { code: 4, message: "unsupported" },
      configurable: true,
    });
    fireEvent.error(el);

    expect(await screen.findByText("This video cannot be played (unsupported format/codec)")).toBeInTheDocument();
    expect(screen.getByText(/Error code 4 — unsupported/)).toBeInTheDocument();
  });

  it("survives a media that never loads", async () => {
    mockAcquire.mockReturnValue({
      promise: Promise.reject(new Error("missing file")),
      release: vi.fn(),
    } as never);

    const { container } = draw();
    await act(async () => {});

    expect(container).toBeTruthy();
  });

  it("surfaces the reason a media could not be loaded", async () => {
    mockAcquire.mockReturnValue({
      promise: Promise.reject(new Error("fichier introuvable")),
      release: vi.fn(),
    } as never);

    draw();
    await act(async () => {});

    expect(await screen.findByText("This video cannot be played (unsupported format/codec)")).toBeInTheDocument();
    expect(screen.getByText(/fichier introuvable/)).toBeInTheDocument();
  });

  it("clears a previous error once the media loads", async () => {
    const { video: el } = draw();
    await act(async () => {});
    Object.defineProperty(el, "error", { value: { code: 4, message: "x" }, configurable: true });
    fireEvent.error(el);
    expect(await screen.findByText(/Error code 4/)).toBeInTheDocument();

    fireEvent.loadedData(el);

    expect(screen.queryByText(/Error code 4/)).not.toBeInTheDocument();
  });

  it("reports an error even when the browser gives no detail", async () => {
    const { video: el } = draw();
    await act(async () => {});

    Object.defineProperty(el, "error", { value: null, configurable: true });
    fireEvent.error(el);

    expect(await screen.findByText(/Error code 0/)).toBeInTheDocument();
  });

  // ── synchronisation du temps de lecture ──────────────────────────────────

  /** Donne au <video> une durée de source et un `currentTime` pilotables. */
  function equipVideo(el: HTMLVideoElement, duration: number, currentTime = 0) {
    Object.defineProperty(el, "duration", { value: duration, configurable: true });
    let t = currentTime;
    Object.defineProperty(el, "currentTime", {
      configurable: true,
      get: () => t,
      set: (v: number) => {
        t = v;
      },
    });
    return () => t;
  }

  /** Rend le composant, équipe le <video>, puis re-rend au temps voulu.
   *
   * `onBeforeRerender` permet de remettre les espions à zéro : l'effet de synchronisation
   * tourne aussi au premier rendu, et on ne veut mesurer que le second. */
  async function sync(
    over: Partial<VideoEl>,
    sourceDuration: number,
    localTime: number,
    props: Record<string, unknown> = {},
    onBeforeRerender: () => void = () => {},
  ) {
    const el = video(over);
    const view = render(
      <VideoElementView element={el} projectDir="/p" localTime={0} playing={false} panTransform="" {...props} />,
    );
    await act(async () => {});
    const node = view.container.querySelector("video") as HTMLVideoElement;
    const read = equipVideo(node, sourceDuration);
    onBeforeRerender();

    view.rerender(
      <VideoElementView
        element={el}
        projectDir="/p"
        localTime={localTime}
        playing={false}
        panTransform=""
        {...props}
      />,
    );
    await act(async () => {});
    return { node, currentTime: read };
  }

  it("suit le temps de la scène dans la source", async () => {
    const { currentTime } = await sync({ start_time: 2, video_offset: 5 }, 60, 12);

    // (12 - 2) × 1 + 5 = 15
    expect(currentTime()).toBeCloseTo(15, 5);
  });

  it("tient compte de la vitesse de lecture", async () => {
    const { currentTime } = await sync({ playback_speed: 2, video_offset: 0 }, 60, 10);

    expect(currentTime()).toBeCloseTo(20, 5);
    expect((await sync({ playback_speed: 2 }, 60, 10)).node.playbackRate).toBe(2);
  });

  it("retombe sur la vitesse normale si elle est nulle", async () => {
    const { node, currentTime } = await sync({ playback_speed: 0 }, 60, 10);

    expect(node.playbackRate).toBe(1);
    expect(currentTime()).toBeCloseTo(10, 5);
  });

  it("gèle sur la dernière image quand la source est épuisée", async () => {
    const { currentTime } = await sync({ loop_video: false, video_offset: 0 }, 10, 30);

    expect(currentTime()).toBeCloseTo(9.95, 5);
  });

  it("reboucle sur le point d'entrée quand la boucle est demandée", async () => {
    // Source de 10 s, entrée à 2 s : la boucle couvre 8 s.
    // Temps visé = 20 + 2 = 22 → 2 + (22 - 2) % 8 = 6.
    const { currentTime } = await sync({ loop_video: true, video_offset: 2 }, 10, 20);

    expect(currentTime()).toBeCloseTo(6, 5);
  });

  it("gèle plutôt que de boucler sur une plage trop courte", async () => {
    // Entrée à 9,99 s dans une source de 10 s : la boucle ferait moins de 0,05 s.
    const { currentTime } = await sync({ loop_video: true, video_offset: 9.99 }, 10, 30);

    expect(currentTime()).toBeCloseTo(9.95, 5);
  });

  it("ne recale pas la vidéo pour un écart négligeable", async () => {
    const el = video({ video_offset: 0 });
    const view = render(
      <VideoElementView element={el} projectDir="/p" localTime={0} playing={false} panTransform="" />,
    );
    await act(async () => {});
    const node = view.container.querySelector("video") as HTMLVideoElement;
    const read = equipVideo(node, 60, 5);

    // 5,1 s demandé contre 5 s en cours : sous le seuil de 0,25 s.
    view.rerender(<VideoElementView element={el} projectDir="/p" localTime={5.1} playing={false} panTransform="" />);
    await act(async () => {});

    expect(read()).toBe(5);
  });

  it("applique le volume et le muet de l'élément", async () => {
    const { node } = await sync({ volume: 0.4, muted: false }, 60, 0);

    expect(node.volume).toBeCloseTo(0.4, 5);
    expect(node.muted).toBe(false);
  });

  it("coupe le son quand le volume tombe à zéro", async () => {
    const { node } = await sync({ volume: 0 }, 60, 0);

    expect(node.muted).toBe(true);
  });

  it("borne un volume hors plage", async () => {
    expect((await sync({ volume: 5 }, 60, 0)).node.volume).toBe(1);
    expect((await sync({ volume: -1 }, 60, 0)).node.volume).toBe(0);
  });

  it("lance la lecture quand la scène joue", async () => {
    const play = vi.fn(() => Promise.resolve());
    HTMLMediaElement.prototype.play = play as never;

    await sync({ video_offset: 0 }, 60, 1, { playing: true });

    expect(play).toHaveBeenCalled();
  });

  it("rejoue en muet si l'autoplay avec son est refusé", async () => {
    // La politique d'autoplay refuse le son : seule une lecture muette est acceptée.
    const play = vi.fn(function (this: HTMLVideoElement) {
      return this.muted ? Promise.resolve() : Promise.reject(new Error("NotAllowedError"));
    });
    HTMLMediaElement.prototype.play = play as never;

    const { node } = await sync({ video_offset: 0, volume: 1, muted: false }, 60, 1, { playing: true }, () =>
      play.mockClear(),
    );
    await act(async () => {});

    // Une tentative avec son, refusée, puis une seconde en muet.
    expect(play).toHaveBeenCalledTimes(2);
    expect(node.muted).toBe(true);
  });

  it("abandonne sans casser si même la lecture muette est refusée", async () => {
    const play = vi.fn(() => Promise.reject(new Error("NotAllowedError")));
    HTMLMediaElement.prototype.play = play as never;

    const { node } = await sync({ video_offset: 0 }, 60, 1, { playing: true }, () => play.mockClear());
    await act(async () => {});

    expect(play).toHaveBeenCalledTimes(2);
    expect(node).toBeTruthy();
  });

  it("ne relance pas la lecture une fois figé sur la fin", async () => {
    const play = vi.fn(() => Promise.resolve());
    const pause = vi.fn();
    HTMLMediaElement.prototype.play = play as never;
    HTMLMediaElement.prototype.pause = pause as never;

    await sync({ loop_video: false, video_offset: 0 }, 10, 30, { playing: true }, () => {
      play.mockClear();
      pause.mockClear();
    });

    expect(play).not.toHaveBeenCalled();
    expect(pause).toHaveBeenCalled();
  });

  it("met en pause quand la scène ne joue pas", async () => {
    const pause = vi.fn();
    HTMLMediaElement.prototype.pause = pause as never;

    await sync({ video_offset: 0 }, 60, 1, { playing: false });

    expect(pause).toHaveBeenCalled();
  });
});
