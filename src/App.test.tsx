import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import App from "./App";

// Doubles légers : le routage entre l'accueil et l'éditeur est tout ce qui se joue ici,
// et les deux écrans ont déjà leurs propres suites.
vi.mock("./components/Home", () => ({
  default: ({ onOpenProject }: { onOpenProject: (dir: string) => void }) => (
    <button type="button" onClick={() => onOpenProject("/projets/demo")}>
      home
    </button>
  ),
}));
vi.mock("./components/Editor", () => ({
  default: ({
    projectDir,
    onBack,
    onOpenProject,
  }: {
    projectDir: string;
    onBack: () => void;
    onOpenProject: (dir: string) => void;
  }) => (
    <div>
      <span>editor:{projectDir}</span>
      <button type="button" onClick={onBack}>
        back
      </button>
      <button type="button" onClick={() => onOpenProject("/projets/autre")}>
        switch
      </button>
    </div>
  ),
}));

describe("App", () => {
  it("démarre sur l'accueil", () => {
    render(<App />);

    expect(screen.getByText("home")).toBeInTheDocument();
    expect(screen.queryByText(/^editor:/)).not.toBeInTheDocument();
  });

  it("ouvre l'éditeur sur le projet choisi", () => {
    render(<App />);

    fireEvent.click(screen.getByText("home"));

    expect(screen.getByText("editor:/projets/demo")).toBeInTheDocument();
  });

  it("revient à l'accueil depuis l'éditeur", () => {
    render(<App />);
    fireEvent.click(screen.getByText("home"));

    fireEvent.click(screen.getByText("back"));

    expect(screen.getByText("home")).toBeInTheDocument();
  });

  it("bascule d'un projet à l'autre sans repasser par l'accueil", () => {
    render(<App />);
    fireEvent.click(screen.getByText("home"));

    fireEvent.click(screen.getByText("switch"));

    expect(screen.getByText("editor:/projets/autre")).toBeInTheDocument();
  });
});
