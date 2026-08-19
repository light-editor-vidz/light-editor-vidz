import { render, screen, fireEvent, act, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { open } from "@tauri-apps/plugin-dialog";
import LibraryPanel from "./LibraryPanel";
import { importAsset, importStockAsset, listAssets, searchStockAssets } from "../../lib/commands";
import type { AssetInfo, StockResult } from "../../lib/commands";

vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));
vi.mock("../../lib/assetUrl", () => ({
  assetUrl: (dir: string, path: string) => `asset://${dir}/${path}`,
}));
vi.mock("../../lib/commands", () => ({
  listAssets: vi.fn(),
  importAsset: vi.fn(),
  searchStockAssets: vi.fn(),
  importStockAsset: vi.fn(),
}));

const mockOpen = vi.mocked(open);
const mockList = vi.mocked(listAssets);
const mockImport = vi.mocked(importAsset);
const mockSearch = vi.mocked(searchStockAssets);
const mockImportStock = vi.mocked(importStockAsset);

const asset = (over: Partial<AssetInfo> = {}): AssetInfo =>
  ({ filename: "clip.mp4", relative_path: "assets/video/clip.mp4", ...over }) as AssetInfo;

const stock = (over: Partial<StockResult> = {}): StockResult => ({
  provider: "Pexels",
  kind: "video",
  thumbnail_url: "https://x/thumb.jpg",
  download_url: "https://x/a.mp4",
  page_url: null,
  author: "Ada",
  license: "CC0",
  duration: 65,
  filename: "a.mp4",
  ...over,
});

async function setup(over: Partial<Parameters<typeof LibraryPanel>[0]> = {}) {
  const handlers = {
    onAddTitle: vi.fn(),
    onAddSubtitle: vi.fn(),
    onAddStyledText: vi.fn(),
    onAddImage: vi.fn(),
    onAddVideo: vi.fn(),
    onAddAudio: vi.fn(),
    onAddShape: vi.fn(),
    onOpenSettings: vi.fn(),
  };
  const view = render(<LibraryPanel active="text" projectDir="/p" {...handlers} {...over} />);
  await act(async () => {});
  return { ...handlers, ...view };
}

const q = (sel: string) => document.querySelector(sel) as HTMLElement;
const qa = (sel: string) => [...document.querySelectorAll(sel)] as HTMLElement[];
const searchBox = () => q(".library-search input");
const onlineBox = () => q(".library-online-searchbar input");

/** Types a query into the online search bar and runs it. */
async function searchOnline(query = "cats") {
  fireEvent.change(onlineBox(), { target: { value: query } });
  await act(async () => {
    fireEvent.click(q(".library-online-searchbar button"));
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockList.mockResolvedValue([]);
  mockSearch.mockResolvedValue({ results: [], errors: [], providers: ["Pexels"] });
  mockImport.mockResolvedValue("assets/video/new.mp4");
  mockImportStock.mockResolvedValue("assets/video/a.mp4");
  mockOpen.mockResolvedValue(null);
});

describe("LibraryPanel — the shell", () => {
  it.each([
    ["text", "Text"],
    ["video", "Videos"],
    ["image", "Images"],
    ["audio", "Audio"],
    ["shape", "Shapes"],
  ] as const)("titles itself after the %s tab", async (active, heading) => {
    await setup({ active });
    expect(screen.getByRole("heading", { name: heading })).toBeInTheDocument();
  });

  it("keeps its own search box", async () => {
    await setup({ active: "shape" });

    fireEvent.change(searchBox(), { target: { value: "star" } });

    expect((searchBox() as HTMLInputElement).value).toBe("star");
  });
});

describe("LibraryPanel — text", () => {
  it("adds a title and a subtitle", async () => {
    const { onAddTitle, onAddSubtitle } = await setup({ active: "text" });

    fireEvent.click(screen.getByText("Add a title"));
    fireEvent.click(screen.getByText("Default subtitle"));

    expect(onAddTitle).toHaveBeenCalled();
    expect(onAddSubtitle).toHaveBeenCalled();
  });

  it("offers a tile per animated style", async () => {
    await setup({ active: "text" });
    expect(qa(".library-style-tile")).toHaveLength(24);
  });

  it("adds the style that was clicked", async () => {
    const { onAddStyledText } = await setup({ active: "text" });

    fireEvent.click(qa(".library-style-tile")[0]);

    expect(onAddStyledText).toHaveBeenCalledWith("neon");
  });
});

describe("LibraryPanel — shapes", () => {
  it("offers every shape", async () => {
    await setup({ active: "shape" });
    expect(qa(".library-shape-tile")).toHaveLength(6);
  });

  it("adds the shape that was clicked", async () => {
    const { onAddShape } = await setup({ active: "shape" });

    fireEvent.click(screen.getByTitle("Star"));

    expect(onAddShape).toHaveBeenCalledWith("star");
  });

  it("filters the shapes by name", async () => {
    await setup({ active: "shape" });

    fireEvent.change(searchBox(), { target: { value: "tri" } });

    expect(qa(".library-shape-tile")).toHaveLength(1);
    expect(screen.getByTitle("Triangle")).toBeInTheDocument();
  });
});

describe("LibraryPanel — local media", () => {
  it("lists the assets already in the project", async () => {
    mockList.mockResolvedValue([asset(), asset({ filename: "b.mp4", relative_path: "assets/video/b.mp4" })]);

    await setup({ active: "video" });

    expect(mockList).toHaveBeenCalledWith("/p", "video");
    expect(qa(".library-media-tile")).toHaveLength(2);
  });

  it("adds an asset to the scene when its tile is clicked", async () => {
    mockList.mockResolvedValue([asset()]);
    const { onAddVideo } = await setup({ active: "video" });

    fireEvent.click(qa(".library-media-tile")[0]);

    expect(onAddVideo).toHaveBeenCalledWith("assets/video/clip.mp4", "clip.mp4");
  });

  it("shows a thumbnail for images", async () => {
    mockList.mockResolvedValue([asset({ filename: "a.png", relative_path: "assets/image/a.png" })]);

    await setup({ active: "image" });

    expect(screen.getByAltText("a.png")).toHaveAttribute("src", "asset:///p/assets/image/a.png");
  });

  it("filters the assets by name", async () => {
    mockList.mockResolvedValue([
      asset({ filename: "cat.mp4" }),
      asset({ filename: "dog.mp4", relative_path: "assets/video/dog.mp4" }),
    ]);
    await setup({ active: "video" });

    fireEvent.change(searchBox(), { target: { value: "CAT" } });

    expect(qa(".library-media-tile")).toHaveLength(1);
  });

  it("reports a listing failure", async () => {
    mockList.mockRejectedValue(new Error("no such project"));

    await setup({ active: "video" });

    expect(await screen.findByText(/no such project/)).toBeInTheDocument();
  });

  it("imports a file and adds it to the scene", async () => {
    mockOpen.mockResolvedValue("/home/me/new.mp4");
    const { onAddVideo } = await setup({ active: "video" });

    await act(async () => {
      fireEvent.click(q(".library-import-tile"));
    });

    expect(mockOpen).toHaveBeenCalledWith(
      expect.objectContaining({ filters: [{ name: "Videos", extensions: ["mp4", "webm", "mov"] }] }),
    );
    expect(mockImport).toHaveBeenCalledWith("/p", "video", "/home/me/new.mp4");
    expect(onAddVideo).toHaveBeenCalledWith("assets/video/new.mp4", "new.mp4");
    // The listing is refreshed so the new file shows up in the grid.
    expect(mockList).toHaveBeenCalledTimes(2);
  });

  it("filters on image extensions in the image tab", async () => {
    mockOpen.mockResolvedValue(null);
    await setup({ active: "image" });

    await act(async () => {
      fireEvent.click(q(".library-import-tile"));
    });

    expect(mockOpen).toHaveBeenCalledWith(
      expect.objectContaining({
        filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp", "gif"] }],
      }),
    );
  });

  it("does nothing when the file dialog is dismissed", async () => {
    const { onAddVideo } = await setup({ active: "video" });

    await act(async () => {
      fireEvent.click(q(".library-import-tile"));
    });

    expect(mockImport).not.toHaveBeenCalled();
    expect(onAddVideo).not.toHaveBeenCalled();
  });

  it("reports a failed import", async () => {
    mockOpen.mockResolvedValue("/home/me/new.mp4");
    mockImport.mockRejectedValue(new Error("unsupported codec"));
    await setup({ active: "video" });

    await act(async () => {
      fireEvent.click(q(".library-import-tile"));
    });

    expect(await screen.findByText(/unsupported codec/)).toBeInTheDocument();
  });
});

describe("LibraryPanel — local audio", () => {
  it("lists the audio files as rows", async () => {
    mockList.mockResolvedValue([asset({ filename: "song.mp3", relative_path: "assets/audio/song.mp3" })]);

    await setup({ active: "audio" });

    expect(qa(".library-audio-item")).toHaveLength(1);
    expect(screen.getByText("song.mp3")).toBeInTheDocument();
  });

  it("adds an audio file to the project", async () => {
    mockList.mockResolvedValue([asset({ filename: "song.mp3", relative_path: "assets/audio/song.mp3" })]);
    const { onAddAudio } = await setup({ active: "audio" });

    fireEvent.click(qa(".library-audio-item")[0]);

    expect(onAddAudio).toHaveBeenCalledWith("assets/audio/song.mp3", "song.mp3");
  });

  it("imports an audio file from its own hint row", async () => {
    mockOpen.mockResolvedValue("/home/me/song.mp3");
    mockImport.mockResolvedValue("assets/audio/song.mp3");
    const { onAddAudio } = await setup({ active: "audio" });

    await act(async () => {
      fireEvent.click(screen.getByText("Import an audio file"));
    });

    expect(mockOpen).toHaveBeenCalledWith(
      expect.objectContaining({ filters: [{ name: "Audio", extensions: ["mp3", "wav", "ogg", "m4a"] }] }),
    );
    expect(onAddAudio).toHaveBeenCalledWith("assets/audio/song.mp3", "song.mp3");
  });
});

describe("LibraryPanel — searching online", () => {
  it("will not search on an empty query", async () => {
    await setup({ active: "video" });

    expect(q(".library-online-searchbar button")).toBeDisabled();

    await act(async () => {
      fireEvent.click(q(".library-online-searchbar button"));
    });
    expect(mockSearch).not.toHaveBeenCalled();
  });

  it("searches the configured providers", async () => {
    await setup({ active: "video" });

    await searchOnline("kittens");

    expect(mockSearch).toHaveBeenCalledWith("video", "kittens");
  });

  it("searches on Enter too", async () => {
    await setup({ active: "image" });
    fireEvent.change(onlineBox(), { target: { value: "sunset" } });

    await act(async () => {
      fireEvent.keyDown(onlineBox(), { key: "Enter" });
    });

    expect(mockSearch).toHaveBeenCalledWith("image", "sunset");
  });

  it("ignores any other key", async () => {
    await setup({ active: "image" });
    fireEvent.change(onlineBox(), { target: { value: "sunset" } });

    fireEvent.keyDown(onlineBox(), { key: "a" });

    expect(mockSearch).not.toHaveBeenCalled();
  });

  it("shows the results as tiles", async () => {
    mockSearch.mockResolvedValue({
      results: [stock(), stock({ download_url: "https://x/b.mp4", filename: "b.mp4", provider: "Pixabay" })],
      errors: [],
      providers: ["Pexels", "Pixabay"],
    });
    await setup({ active: "video" });

    await searchOnline();

    expect(qa(".library-media-tile")).toHaveLength(2);
    expect(screen.getByAltText("a.mp4")).toHaveAttribute("src", "https://x/thumb.jpg");
  });

  it("falls back to an icon when a result has no thumbnail", async () => {
    mockSearch.mockResolvedValue({
      results: [stock({ thumbnail_url: null })],
      errors: [],
      providers: ["Pexels"],
    });
    await setup({ active: "video" });

    await searchOnline();

    expect(screen.queryByAltText("a.mp4")).toBeNull();
    expect(qa(".library-media-tile")).toHaveLength(1);
  });

  it("says when nothing was found", async () => {
    await setup({ active: "video" });

    await searchOnline();

    expect(screen.getByText("No results")).toBeInTheDocument();
  });

  it("offers to add an API key when no provider is configured", async () => {
    mockSearch.mockResolvedValue({ results: [], errors: [], providers: [] });
    const { onOpenSettings } = await setup({ active: "video" });

    await searchOnline();

    fireEvent.click(screen.getByText(/No provider configured/));
    expect(onOpenSettings).toHaveBeenCalled();
  });

  it("opens the settings from the header button", async () => {
    const { onOpenSettings } = await setup({ active: "video" });

    fireEvent.click(screen.getByTitle("Configure API keys"));

    expect(onOpenSettings).toHaveBeenCalled();
  });

  it("shows a per-provider warning without hiding the results", async () => {
    mockSearch.mockResolvedValue({
      results: [stock()],
      errors: ["Pixabay: invalid key"],
      providers: ["Pexels", "Pixabay"],
    });
    await setup({ active: "video" });

    await searchOnline();

    expect(screen.getByText("Pixabay: invalid key")).toBeInTheDocument();
    expect(qa(".library-media-tile")).toHaveLength(1);
  });

  it("reports a search that failed outright", async () => {
    mockSearch.mockRejectedValue(new Error("offline"));
    await setup({ active: "video" });

    await searchOnline();

    expect(screen.getByText(/offline/)).toBeInTheDocument();
  });
});

describe("LibraryPanel — importing from online", () => {
  beforeEach(() => {
    mockSearch.mockResolvedValue({ results: [stock()], errors: [], providers: ["Pexels"] });
  });

  it("imports an image straight from its tile", async () => {
    mockSearch.mockResolvedValue({
      results: [stock({ kind: "image", filename: "a.jpg", download_url: "https://x/a.jpg" })],
      errors: [],
      providers: ["Pexels"],
    });
    mockImportStock.mockResolvedValue("assets/image/a.jpg");
    const { onAddImage } = await setup({ active: "image" });
    await searchOnline();

    await act(async () => {
      fireEvent.click(qa(".library-media-tile")[0]);
    });

    expect(mockImportStock).toHaveBeenCalledWith("/p", "image", "https://x/a.jpg", "a.jpg");
    expect(onAddImage).toHaveBeenCalledWith("assets/image/a.jpg", "a.jpg");
  });

  it("previews a video before importing it", async () => {
    await setup({ active: "video" });
    await searchOnline();

    fireEvent.click(qa(".library-media-tile")[0]);

    expect(q(".stock-preview-modal")).toBeInTheDocument();
    expect(q(".stock-preview-video")).toHaveAttribute("src", "https://x/a.mp4");
    expect(mockImportStock).not.toHaveBeenCalled();
  });

  it("closes the preview from its close button and from the backdrop", async () => {
    await setup({ active: "video" });
    await searchOnline();

    fireEvent.click(qa(".library-media-tile")[0]);
    fireEvent.click(q(".modal-close"));
    expect(q(".stock-preview-modal")).toBeNull();

    fireEvent.click(qa(".library-media-tile")[0]);
    fireEvent.click(q(".modal-backdrop"));
    expect(q(".stock-preview-modal")).toBeNull();
  });

  it("keeps the preview open when its own body is clicked", async () => {
    await setup({ active: "video" });
    await searchOnline();
    fireEvent.click(qa(".library-media-tile")[0]);

    fireEvent.click(q(".stock-preview-modal"));

    expect(q(".stock-preview-modal")).toBeInTheDocument();
  });

  it("imports the previewed video and closes the preview", async () => {
    const { onAddVideo } = await setup({ active: "video" });
    await searchOnline();
    fireEvent.click(qa(".library-media-tile")[0]);

    await act(async () => {
      fireEvent.click(within(q(".stock-preview-modal")).getByText("Add to project"));
    });

    expect(mockImportStock).toHaveBeenCalledWith("/p", "video", "https://x/a.mp4", "a.mp4");
    expect(onAddVideo).toHaveBeenCalledWith("assets/video/a.mp4", "a.mp4");
    expect(q(".stock-preview-modal")).toBeNull();
  });

  it("reports a failed download", async () => {
    mockImportStock.mockRejectedValue(new Error("403 forbidden"));
    await setup({ active: "video" });
    await searchOnline();
    fireEvent.click(qa(".library-media-tile")[0]);

    await act(async () => {
      fireEvent.click(within(q(".stock-preview-modal")).getByText("Add to project"));
    });

    expect(await screen.findByText(/403 forbidden/)).toBeInTheDocument();
  });

  it("only downloads one asset at a time", async () => {
    let release: (v: string) => void = () => {};
    mockImportStock.mockReturnValue(new Promise((r) => (release = r)));
    await setup({ active: "video" });
    await searchOnline();
    fireEvent.click(qa(".library-media-tile")[0]);
    const modal = q(".stock-preview-modal");

    await act(async () => {
      fireEvent.click(within(modal).getByText("Add to project"));
    });
    fireEvent.click(within(modal).getByRole("button", { name: /Add to project/ }));

    expect(mockImportStock).toHaveBeenCalledTimes(1);
    await act(async () => {
      release("assets/video/a.mp4");
    });
  });
});

describe("LibraryPanel — online audio", () => {
  const song = stock({
    kind: "audio",
    filename: "song.mp3",
    download_url: "https://x/song.mp3",
    duration: 125,
  });

  beforeEach(() => {
    mockSearch.mockResolvedValue({ results: [song], errors: [], providers: ["Freesound"] });
    mockImportStock.mockResolvedValue("assets/audio/song.mp3");
  });

  it("lists the results as rows with their duration", async () => {
    await setup({ active: "audio" });

    await searchOnline();

    expect(screen.getByText("song.mp3")).toBeInTheDocument();
    expect(screen.getByText("2:05")).toBeInTheDocument();
  });

  it("omits the duration when the provider does not give one", async () => {
    mockSearch.mockResolvedValue({ results: [{ ...song, duration: null }], errors: [], providers: ["Freesound"] });
    await setup({ active: "audio" });

    await searchOnline();

    expect(q(".library-online-duration")).toBeNull();
  });

  it("previews the sound on click and stops it on a second click", async () => {
    await setup({ active: "audio" });
    await searchOnline();
    const row = qa(".library-audio-item")[0];

    fireEvent.click(row);
    expect(q("audio")).toHaveAttribute("src", "https://x/song.mp3");

    fireEvent.click(row);
    expect(q("audio")).toBeNull();
  });

  it("stops the preview when the sound ends", async () => {
    await setup({ active: "audio" });
    await searchOnline();
    fireEvent.click(qa(".library-audio-item")[0]);

    fireEvent.ended(q("audio"));

    expect(q("audio")).toBeNull();
  });

  it("adds the sound to the project without previewing it", async () => {
    const { onAddAudio } = await setup({ active: "audio" });
    await searchOnline();

    await act(async () => {
      fireEvent.click(screen.getByTitle("Add to project"));
    });

    expect(mockImportStock).toHaveBeenCalledWith("/p", "audio", "https://x/song.mp3", "song.mp3");
    expect(onAddAudio).toHaveBeenCalledWith("assets/audio/song.mp3", "song.mp3");
    expect(q("audio")).toBeNull();
  });

  it("clears the previous results when a new search starts", async () => {
    await setup({ active: "audio" });
    await searchOnline();
    fireEvent.click(qa(".library-audio-item")[0]);

    mockSearch.mockResolvedValue({ results: [], errors: [], providers: ["Freesound"] });
    await searchOnline("other");

    await waitFor(() => expect(q("audio")).toBeNull());
    expect(screen.getByText("No results")).toBeInTheDocument();
  });
});
