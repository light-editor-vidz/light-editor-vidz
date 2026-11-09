import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import TabBar from "./TabBar";
import { HOME, type Tab } from "../lib/tabs";

const project: Tab = { id: "project-1", kind: "project", dir: "/work/Spot A.lvproj", notice: null, media: null };
const audio: Tab = { id: "audio-1", kind: "audio", path: "/music/song.mp3" };
const emptyAudio: Tab = { id: "audio-2", kind: "audio", path: null };

function setup(tabs: Tab[], active: string = HOME) {
  const handlers = { onActivate: vi.fn(), onClose: vi.fn() };
  render(<TabBar tabs={tabs} active={active} {...handlers} />);
  return handlers;
}

describe("TabBar", () => {
  it("n'a que l'accueil quand rien n'est ouvert", () => {
    setup([]);

    expect(screen.getAllByRole("tab")).toHaveLength(1);
    expect(screen.getByRole("tab", { name: "Home" })).toHaveAttribute("aria-selected", "true");
  });

  it("nomme chaque onglet d'après son projet (sans l'extension) ou son fichier", () => {
    setup([project, audio, emptyAudio]);

    expect(screen.getByRole("tab", { name: "Spot A" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "song.mp3" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Audio" })).toBeInTheDocument();
  });

  it("marque l'onglet affiché", () => {
    setup([project, audio], "audio-1");

    expect(screen.getByRole("tab", { name: "song.mp3" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Home" })).toHaveAttribute("aria-selected", "false");
    expect(screen.getByRole("tab", { name: "Spot A" })).toHaveAttribute("aria-selected", "false");
  });

  it("active l'onglet cliqué, accueil compris", () => {
    const { onActivate } = setup([project, audio], "audio-1");

    fireEvent.click(screen.getByRole("tab", { name: "Spot A" }));
    fireEvent.click(screen.getByRole("tab", { name: "Home" }));

    expect(onActivate.mock.calls).toEqual([["project-1"], [HOME]]);
  });

  it("ferme un onglet par sa croix sans l'activer", () => {
    const { onClose, onActivate } = setup([project, audio]);

    fireEvent.click(screen.getByRole("button", { name: "Close song.mp3" }));

    expect(onClose).toHaveBeenCalledWith("audio-1");
    expect(onActivate).not.toHaveBeenCalled();
  });

  it("l'accueil n'a pas de croix", () => {
    setup([]);
    expect(screen.queryByRole("button", { name: /^Close/ })).not.toBeInTheDocument();
  });

  it("montre le chemin complet au survol", () => {
    setup([audio]);
    expect(screen.getByRole("tab", { name: "song.mp3" })).toHaveAttribute("title", "/music/song.mp3");
  });
});
