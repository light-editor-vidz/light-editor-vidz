import { describe, expect, it } from "vitest";
import { parseLegacyProjectJSON } from "./legacyImport";

describe("parseLegacyProjectJSON", () => {
  it("throws on invalid input", () => {
    expect(() => parseLegacyProjectJSON(null)).toThrow();
    expect(() => parseLegacyProjectJSON("not an object")).toThrow();
  });

  it("falls back to sensible defaults for a minimal legacy project", () => {
    const result = parseLegacyProjectJSON({});
    expect(result.width).toBe(1920);
    expect(result.height).toBe(1080);
    expect(result.compositions).toHaveLength(1);
  });

  it("converts a text element from top/left anchor pixels to x/y percentages", () => {
    const legacy = {
      name: "Legacy video",
      width: 1000,
      height: 500,
      duration: 5,
      compositions: [
        {
          id: "c1",
          name: "Scene 1",
          startTime: 0,
          duration: 5,
          elements: [
            {
              id: "t1",
              type: "text",
              // Ancre centrée : top/left pointent le centre de l'élément.
              top: 250,
              left: 500,
              width: 200,
              height: 100,
              topOrigin: "center",
              leftOrigin: "center",
              content: "Hello",
              fontSize: 50,
            },
          ],
        },
      ],
    };

    const result = parseLegacyProjectJSON(legacy);
    expect(result.name).toBe("Legacy video");
    const comp = result.compositions[0];
    expect(comp.elements).toHaveLength(1);
    const el = comp.elements[0];
    expect(el.type).toBe("text");
    // Coin haut-gauche attendu : (500 - 200/2, 250 - 100/2) = (400, 200) px -> 40%/40% de 1000x500.
    expect(el.x).toBeCloseTo(40);
    expect(el.y).toBeCloseTo(40);
    expect(el.width).toBeCloseTo(20);
    expect(el.height).toBeCloseTo(20);
    if (el.type === "text") {
      // fontSize 50px sur une largeur de canvas de 1000px -> 5 cqw.
      expect(el.font_size).toBeCloseTo(5);
      expect(el.content).toBe("Hello");
    }
  });

  it("converts GSAP-style dotted easing names to our kebab-case schema", () => {
    const legacy = {
      width: 1000,
      height: 500,
      duration: 5,
      compositions: [
        {
          id: "c1",
          duration: 5,
          elements: [
            {
              id: "t1",
              type: "text",
              top: 0,
              left: 0,
              width: 100,
              height: 100,
              content: "x",
              animations: [{ type: "fade", direction: "in", duration: 1, easing: "power2.inOut" }],
            },
          ],
        },
      ],
    };

    const result = parseLegacyProjectJSON(legacy);
    const el = result.compositions[0].elements[0];
    expect(el.animations[0].easing).toBe("power2-in-out");
  });

  it("drops elements with an unknown type instead of throwing", () => {
    const legacy = {
      width: 1000,
      height: 500,
      duration: 5,
      compositions: [
        {
          id: "c1",
          duration: 5,
          elements: [
            { id: "x", type: "unknown-type" },
            { id: "t1", type: "shape", shapeType: "star" },
          ],
        },
      ],
    };

    const result = parseLegacyProjectJSON(legacy);
    expect(result.compositions[0].elements).toHaveLength(1);
    expect(result.compositions[0].elements[0].type).toBe("shape");
  });
});

describe("parseLegacyProjectJSON — médias, formes, animations et audio", () => {
  /** Projet hérité minimal portant les éléments donnés dans une seule scène. */
  const withElements = (elements: unknown[], over: Record<string, unknown> = {}) =>
    parseLegacyProjectJSON({
      width: 1000,
      height: 500,
      duration: 5,
      compositions: [{ id: "c1", name: "Scene 1", duration: 5, elements }],
      ...over,
    });

  const firstElement = (elements: unknown[]) => withElements(elements).compositions[0].elements[0];

  const media = (over: Record<string, unknown> = {}) => ({
    type: "image",
    top: 0,
    left: 0,
    width: 400,
    height: 200,
    anchor: "top-left",
    src: "assets/a.png",
    ...over,
  });

  it("importe une image avec sa source et son mode d'ajustement", () => {
    const el = firstElement([media({ fitMode: "stretch", backgroundColor: "#000" })]);

    expect(el).toMatchObject({
      type: "image",
      src: "assets/a.png",
      fit_mode: "stretch",
      background_color: "#000",
    });
  });

  it("retombe sur « cover » pour un mode d'ajustement inconnu", () => {
    const el = firstElement([media({ fitMode: "squish" })]);

    expect(el).toMatchObject({ fit_mode: "cover" });
  });

  it("accepte une image sans source", () => {
    const el = firstElement([media({ src: undefined })]);

    expect(el).toMatchObject({ src: "", background_color: null });
  });

  it("importe un effet Ken Burns", () => {
    const el = firstElement([media({ imagePan: { type: "zoomIn", intensity: 0.8 } })]);

    expect(el).toMatchObject({ image_pan: { pan_type: "zoomIn", intensity: 0.8 } });
  });

  it("donne une intensité par défaut au Ken Burns", () => {
    const el = firstElement([media({ imagePan: { type: "panLeft" } })]);

    expect(el).toMatchObject({ image_pan: { pan_type: "panLeft", intensity: 0.5 } });
  });

  it("ignore un Ken Burns de type inconnu", () => {
    const el = firstElement([media({ imagePan: { type: "spin" } })]);

    expect(el).toMatchObject({ image_pan: null });
  });

  it("importe une vidéo avec son point d'entrée", () => {
    const el = firstElement([media({ type: "video", src: "a.mp4", videoOffset: 3.5 })]);

    expect(el).toMatchObject({
      type: "video",
      src: "a.mp4",
      video_offset: 3.5,
      volume: 1,
      muted: false,
      playback_speed: 1,
      loop_video: false,
    });
  });

  it("place le point d'entrée vidéo à zéro par défaut", () => {
    const el = firstElement([media({ type: "video", src: "a.mp4" })]);

    expect(el).toMatchObject({ video_offset: 0 });
  });

  it("importe une forme", () => {
    const el = firstElement([media({ type: "shape", shapeType: "ellipse" })]);

    expect(el).toMatchObject({ type: "shape" });
  });

  it("écarte un élément de type inconnu", () => {
    const comp = withElements([media({ type: "particle" }), media()]).compositions[0];

    expect(comp.elements).toHaveLength(1);
    expect(comp.elements[0].type).toBe("image");
  });

  it("écarte une entrée d'élément qui n'est pas un objet", () => {
    const comp = withElements([null, "texte", 42, media()]).compositions[0];

    expect(comp.elements).toHaveLength(1);
  });

  it("importe les animations reconnues et écarte les autres", () => {
    const el = firstElement([
      media({
        animations: [
          { type: "fade", direction: "out", duration: 1.2, easing: "power2.inOut", withFade: true },
          { type: "teleport" },
          null,
          "fade",
        ],
      }),
    ]);

    expect(el.animations).toEqual([
      {
        animation_type: "fade",
        direction: "out",
        duration: 1.2,
        easing: "power2-in-out",
        with_fade: true,
      },
    ]);
  });

  it("donne des valeurs par défaut à une animation minimale", () => {
    const el = firstElement([media({ animations: [{ type: "zoom-in" }] })]);

    expect(el.animations[0]).toMatchObject({
      animation_type: "zoom-in",
      direction: "in",
      duration: 0.6,
      easing: "linear",
      with_fade: false,
    });
  });

  it("retombe sur « linear » pour un easing inconnu", () => {
    const el = firstElement([media({ animations: [{ type: "fade", easing: "elastic.out" }] })]);

    expect(el.animations[0].easing).toBe("linear");
  });

  it("ignore une liste d'animations qui n'en est pas une", () => {
    const el = firstElement([media({ animations: "fade" })]);

    expect(el.animations).toEqual([]);
  });

  it("importe les transitions de scène", () => {
    const project = parseLegacyProjectJSON({
      compositions: [
        {
          id: "c1",
          duration: 5,
          elements: [],
          transitionIn: { type: "fade", duration: 1, easing: "power1.in" },
          transitionOut: { type: "wipe-left" },
          overlapNext: 0.75,
        },
      ],
    });

    const comp = project.compositions[0];
    expect(comp.transition_in).toEqual({
      transition_type: "fade",
      duration: 1,
      easing: "power1-in",
    });
    expect(comp.transition_out).toMatchObject({ transition_type: "wipe-left", duration: 0.6 });
    expect(comp.overlap_next).toBe(0.75);
  });

  it("ignore une transition de type inconnu", () => {
    const project = parseLegacyProjectJSON({
      compositions: [{ id: "c1", duration: 5, elements: [], transitionIn: { type: "dissolve" } }],
    });

    expect(project.compositions[0].transition_in).toBeNull();
  });

  it("ignore une transition qui n'est pas un objet", () => {
    const project = parseLegacyProjectJSON({
      compositions: [{ id: "c1", duration: 5, elements: [], transitionIn: "fade", transitionOut: null }],
    });

    expect(project.compositions[0].transition_in).toBeNull();
    expect(project.compositions[0].transition_out).toBeNull();
  });

  it("importe les pistes audio du projet", () => {
    const project = parseLegacyProjectJSON({
      audioTracks: [
        { id: "a1", name: "Musique", src: "m.mp3", startTime: 2, duration: 30, volume: 0.5, audioOffset: 1 },
      ],
    });

    expect(project.audio_tracks[0]).toMatchObject({
      id: "a1",
      name: "Musique",
      src: "m.mp3",
      start_time: 2,
      duration: 30,
      volume: 0.5,
      audio_offset: 1,
      muted: false,
      solo: false,
    });
  });

  it("complète une piste audio minimale", () => {
    const project = parseLegacyProjectJSON({ audioTracks: [{}] });

    const track = project.audio_tracks[0];
    expect(track.name).toBe("Audio");
    expect(track.src).toBe("");
    expect(track.start_time).toBe(0);
    expect(track.duration).toBeNull();
    expect(track.volume).toBe(1);
    expect(track.id).toBeTruthy();
  });

  it("borne le volume d'une piste audio", () => {
    const project = parseLegacyProjectJSON({ audioTracks: [{ volume: 5 }, { volume: -1 }] });

    expect(project.audio_tracks[0].volume).toBe(1);
    expect(project.audio_tracks[1].volume).toBe(0);
  });

  it("écarte une piste audio qui n'est pas un objet", () => {
    const project = parseLegacyProjectJSON({ audioTracks: [null, "musique", {}] });

    expect(project.audio_tracks).toHaveLength(1);
  });

  it("ignore une liste de pistes qui n'en est pas une", () => {
    const project = parseLegacyProjectJSON({ audioTracks: "m.mp3" });

    expect(project.audio_tracks).toEqual([]);
  });
});
