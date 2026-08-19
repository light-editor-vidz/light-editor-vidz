import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { open } from "@tauri-apps/plugin-dialog";
import { listRecentProjects, newProject, type RecentProject } from "../lib/commands";
import Home from "./Home";
import NewProjectModal from "./NewProjectModal";

vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));
vi.mock("../lib/commands", () => ({
  listRecentProjects: vi.fn(),
  newProject: vi.fn(),
}));

const mockOpen = vi.mocked(open);
const mockList = vi.mocked(listRecentProjects);
const mockNewProject = vi.mocked(newProject);

const recent = (over: Partial<RecentProject> = {}): RecentProject => ({
  path: "/home/me/clip.lvproj",
  name: "clip",
  width: 1920,
  height: 1080,
  duration: 12,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  mockList.mockResolvedValue([]);
  mockOpen.mockResolvedValue(null);
});

describe("Home — layout", () => {
  it("shows the tagline and both actions", async () => {
    render(<Home onOpenProject={vi.fn()} />);

    expect(screen.getByRole("button", { name: /New project/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Open project/ })).toBeInTheDocument();
    await act(async () => {});
  });

  it("hides the recents section when there is none", async () => {
    render(<Home onOpenProject={vi.fn()} />);
    await act(async () => {});
    expect(screen.queryByText("Recent projects")).not.toBeInTheDocument();
  });

  it("lists the recent projects with their size", async () => {
    mockList.mockResolvedValue([recent(), recent({ path: "/b", name: "second", width: 1080, height: 1080 })]);
    render(<Home onOpenProject={vi.fn()} />);

    expect(await screen.findByText("Recent projects")).toBeInTheDocument();
    expect(screen.getByText("clip")).toBeInTheDocument();
    expect(screen.getByText("1920×1080")).toBeInTheDocument();
    expect(screen.getByText("2 projects")).toBeInTheDocument();
  });

  it("uses the singular wording for a lone project", async () => {
    mockList.mockResolvedValue([recent()]);
    render(<Home onOpenProject={vi.fn()} />);
    expect(await screen.findByText("1 project")).toBeInTheDocument();
  });

  it.each([
    [1920, 1080, "16:9"],
    [1080, 1920, "9:16"],
    [1080, 1080, "1:1"],
    [0, 0, "0:0"],
  ])("labels a %i×%i project as %s", async (width, height, label) => {
    mockList.mockResolvedValue([recent({ width, height })]);
    render(<Home onOpenProject={vi.fn()} />);
    expect(await screen.findByText(label)).toBeInTheDocument();
  });

  it("shows the reason when the recents cannot be read", async () => {
    mockList.mockRejectedValue(new Error("store unreadable"));
    render(<Home onOpenProject={vi.fn()} />);
    expect(await screen.findByText(/store unreadable/)).toBeInTheDocument();
  });
});

describe("Home — opening", () => {
  it("opens a recent project by its path", async () => {
    const onOpenProject = vi.fn();
    mockList.mockResolvedValue([recent()]);
    render(<Home onOpenProject={onOpenProject} />);
    await screen.findByText("clip");

    fireEvent.click(screen.getByText("clip"));

    expect(onOpenProject).toHaveBeenCalledWith("/home/me/clip.lvproj");
  });

  it("opens a project picked from the folder dialog", async () => {
    const onOpenProject = vi.fn();
    mockOpen.mockResolvedValue("/home/me/other.lvproj");
    render(<Home onOpenProject={onOpenProject} />);

    fireEvent.click(screen.getByRole("button", { name: /Open project/ }));

    await waitFor(() => expect(onOpenProject).toHaveBeenCalledWith("/home/me/other.lvproj"));
    expect(mockOpen).toHaveBeenCalledWith({ directory: true, multiple: false });
  });

  it("opens nothing when the dialog is dismissed", async () => {
    const onOpenProject = vi.fn();
    render(<Home onOpenProject={onOpenProject} />);

    fireEvent.click(screen.getByRole("button", { name: /Open project/ }));
    await act(async () => {});

    expect(onOpenProject).not.toHaveBeenCalled();
  });

  it("opens nothing when the dialog returns several folders", async () => {
    const onOpenProject = vi.fn();
    mockOpen.mockResolvedValue(["/a", "/b"] as never);
    render(<Home onOpenProject={onOpenProject} />);

    fireEvent.click(screen.getByRole("button", { name: /Open project/ }));
    await act(async () => {});

    expect(onOpenProject).not.toHaveBeenCalled();
  });
});

describe("Home — new project modal", () => {
  it("opens and closes the modal", async () => {
    render(<Home onOpenProject={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: /New project/ }));
    expect(await screen.findByText("New video")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByText("New video")).not.toBeInTheDocument());
  });

  it("opens the project the modal just created", async () => {
    const onOpenProject = vi.fn();
    mockOpen.mockResolvedValue("/home/me");
    mockNewProject.mockResolvedValue("/home/me/fresh.lvproj");
    render(<Home onOpenProject={onOpenProject} />);
    fireEvent.click(screen.getByRole("button", { name: /New project/ }));
    await screen.findByText("New video");

    fireEvent.click(screen.getByRole("button", { name: /Create/ }));

    await waitFor(() => expect(onOpenProject).toHaveBeenCalledWith("/home/me/fresh.lvproj"));
    expect(screen.queryByText("New video")).not.toBeInTheDocument();
  });
});

describe("NewProjectModal", () => {
  function setup() {
    const onCreated = vi.fn();
    const onClose = vi.fn();
    const view = render(<NewProjectModal onCreated={onCreated} onClose={onClose} />);
    return { onCreated, onClose, ...view };
  }

  it("preselects 16:9 and 30 fps", () => {
    const { container } = setup();
    expect(container.querySelector(".resolution-option.selected")).toHaveTextContent("16:9");
    expect(container.querySelector(".fps-option.selected")).toHaveTextContent("30");
  });

  it("changes the resolution", () => {
    const { container } = setup();

    fireEvent.click(screen.getByText("UHD"));

    expect(container.querySelector(".resolution-option.selected")).toHaveTextContent("UHD");
  });

  it("changes the frame rate", () => {
    const { container } = setup();

    fireEvent.click(screen.getByText("Cinema"));

    expect(container.querySelector(".fps-option.selected")).toHaveTextContent("24");
  });

  it("sends the chosen settings to the backend", async () => {
    mockOpen.mockResolvedValue("/home/me");
    mockNewProject.mockResolvedValue("/home/me/x.lvproj");
    const { onCreated } = setup();

    fireEvent.change(screen.getByLabelText("Project name"), { target: { value: "My clip" } });
    fireEvent.click(screen.getByText("9:16"));
    fireEvent.click(screen.getByText("Smooth"));
    fireEvent.click(screen.getByRole("button", { name: /Create/ }));

    await waitFor(() =>
      expect(mockNewProject).toHaveBeenCalledWith({
        parent_dir: "/home/me",
        name: "My clip",
        width: 1080,
        height: 1920,
        fps: 60,
      }),
    );
    expect(onCreated).toHaveBeenCalledWith("/home/me/x.lvproj");
  });

  it("creates nothing when the folder dialog is dismissed", async () => {
    const { onCreated } = setup();

    fireEvent.click(screen.getByRole("button", { name: /Create/ }));
    await act(async () => {});

    expect(mockNewProject).not.toHaveBeenCalled();
    expect(onCreated).not.toHaveBeenCalled();
  });

  it("creates nothing when several folders come back", async () => {
    mockOpen.mockResolvedValue(["/a", "/b"] as never);
    setup();

    fireEvent.click(screen.getByRole("button", { name: /Create/ }));
    await act(async () => {});

    expect(mockNewProject).not.toHaveBeenCalled();
  });

  it("shows the reason when creation fails", async () => {
    mockOpen.mockResolvedValue("/home/me");
    mockNewProject.mockRejectedValue(new Error("disk full"));
    setup();

    fireEvent.click(screen.getByRole("button", { name: /Create/ }));

    expect(await screen.findByText(/disk full/)).toBeInTheDocument();
  });

  it("blocks creation while the name is empty", () => {
    setup();

    fireEvent.change(screen.getByLabelText("Project name"), { target: { value: "   " } });

    expect(screen.getByRole("button", { name: /Create/ })).toBeDisabled();
  });

  it("closes from the cancel button and the backdrop, but not the panel", () => {
    const { onClose, container } = setup();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByText("New video"));
    fireEvent.click(container.querySelector(".modal-backdrop")!);

    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
