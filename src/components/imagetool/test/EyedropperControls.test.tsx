import "./setup";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { EyedropperControls } from "../EyedropperControls";

const writeText = vi.fn();

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  writeText.mockReset().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText },
    configurable: true,
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("EyedropperControls — no colour yet", () => {
  it("shows the hint until a pixel is picked", () => {
    render(<EyedropperControls color={null} />);
    expect(screen.getByText("Hover over the image to pick a color · click to confirm")).toBeInTheDocument();
  });
});

describe("EyedropperControls — colour formats", () => {
  const opaque = { r: 255, g: 128, b: 0, a: 255 };

  it("renders the hex, rgb and hsl chips", () => {
    render(<EyedropperControls color={opaque} />);

    expect(screen.getByText("#FF8000")).toBeInTheDocument();
    expect(screen.getByText("rgb(255, 128, 0)")).toBeInTheDocument();
    expect(screen.getByText("hsl(30, 100%, 50%)")).toBeInTheDocument();
  });

  it("hides the rgba chip for a fully opaque colour", () => {
    render(<EyedropperControls color={opaque} />);
    expect(screen.queryByText(/^rgba\(/)).not.toBeInTheDocument();
  });

  it("adds an rgba chip for a translucent colour", () => {
    render(<EyedropperControls color={{ ...opaque, a: 128 }} />);
    expect(screen.getByText("rgba(255, 128, 0, 0.50)")).toBeInTheDocument();
  });

  it("zero-pads each hex channel", () => {
    render(<EyedropperControls color={{ r: 1, g: 2, b: 3, a: 255 }} />);
    expect(screen.getByText("#010203")).toBeInTheDocument();
  });

  it("reports a grey as having no hue or saturation", () => {
    render(<EyedropperControls color={{ r: 128, g: 128, b: 128, a: 255 }} />);
    expect(screen.getByText("hsl(0, 0%, 50%)")).toBeInTheDocument();
  });

  it.each([
    [{ r: 255, g: 0, b: 0 }, "hsl(0, 100%, 50%)"],
    [{ r: 0, g: 255, b: 0 }, "hsl(120, 100%, 50%)"],
    [{ r: 0, g: 0, b: 255 }, "hsl(240, 100%, 50%)"],
    [{ r: 0, g: 0, b: 0 }, "hsl(0, 0%, 0%)"],
    [{ r: 255, g: 255, b: 255 }, "hsl(0, 0%, 100%)"],
  ])("converts %j to %s", (rgb, expected) => {
    render(<EyedropperControls color={{ ...rgb, a: 255 }} />);
    expect(screen.getByText(expected)).toBeInTheDocument();
  });

  it("picks the blue branch when blue dominates a dark colour", () => {
    render(<EyedropperControls color={{ r: 10, g: 20, b: 200, a: 255 }} />);
    expect(screen.getByText(/^hsl\(23[0-9],/)).toBeInTheDocument();
  });
});

describe("EyedropperControls — copying", () => {
  const opaque = { r: 255, g: 128, b: 0, a: 255 };

  it("copies the hex from the swatch and confirms", async () => {
    render(<EyedropperControls color={opaque} />);

    fireEvent.click(screen.getByTitle("Click to copy HEX"));

    expect(writeText).toHaveBeenCalledWith("#FF8000");
    expect(await screen.findByText("HEX copied")).toBeInTheDocument();
  });

  it("copies from each chip", async () => {
    render(<EyedropperControls color={opaque} />);

    fireEvent.click(screen.getByTitle("Copy RGB"));

    expect(writeText).toHaveBeenCalledWith("rgb(255, 128, 0)");
    expect(await screen.findByText("RGB copied")).toBeInTheDocument();
  });

  it("clears the confirmation after a moment", async () => {
    render(<EyedropperControls color={opaque} />);
    fireEvent.click(screen.getByTitle("Copy HSL"));
    await screen.findByText("HSL copied");

    vi.advanceTimersByTime(1600);

    await waitFor(() => expect(screen.queryByText("HSL copied")).not.toBeInTheDocument());
  });

  it("stays quiet when the clipboard refuses", async () => {
    writeText.mockRejectedValue(new Error("denied"));
    render(<EyedropperControls color={opaque} />);

    fireEvent.click(screen.getByTitle("Copy RGB"));

    await waitFor(() => expect(writeText).toHaveBeenCalled());
    expect(screen.queryByText("RGB copied")).not.toBeInTheDocument();
  });

  it("stays quiet when the swatch copy refuses", async () => {
    writeText.mockRejectedValue(new Error("denied"));
    render(<EyedropperControls color={opaque} />);

    fireEvent.click(screen.getByTitle("Click to copy HEX"));

    await waitFor(() => expect(writeText).toHaveBeenCalled());
    expect(screen.queryByText("HEX copied")).not.toBeInTheDocument();
  });

  it("restarts the timer when copying twice in a row", async () => {
    render(<EyedropperControls color={opaque} />);
    fireEvent.click(screen.getByTitle("Copy HEX"));
    await screen.findByText("HEX copied");

    vi.advanceTimersByTime(1000);
    fireEvent.click(screen.getByTitle("Copy RGB"));

    expect(await screen.findByText("RGB copied")).toBeInTheDocument();
  });
});
