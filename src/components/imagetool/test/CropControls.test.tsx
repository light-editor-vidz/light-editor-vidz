import "./setup";
import { render, screen, fireEvent, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { CropControls } from "../CropControls";
import { CropBar } from "../CropBar";
import type { CropStore } from "../CropBar";
import type { CropApi } from "../hooks/useCrop";

function apiSpy(): CropApi {
  return { setRect: vi.fn(), setAspect: vi.fn(), nudge: vi.fn() };
}

describe("CropControls", () => {
  const rect = { x: 0, y: 0, width: 640, height: 480 };

  it("has no ratio or numeric fields without a crop API", () => {
    render(<CropControls cropRect={rect} isLoading={false} onApply={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.queryByLabelText("Aspect ratio")).toBeNull();
  });

  it("imposes the chosen aspect ratio", async () => {
    const api = apiSpy();
    render(
      <CropControls cropRect={rect} isLoading={false} apiRef={{ current: api }} onApply={vi.fn()} onCancel={vi.fn()} />,
    );

    await userEvent.selectOptions(screen.getByLabelText("Aspect ratio"), "16:9");
    expect(api.setAspect).toHaveBeenLastCalledWith(16 / 9);

    await userEvent.selectOptions(screen.getByLabelText("Aspect ratio"), "free");
    expect(api.setAspect).toHaveBeenLastCalledWith(null);
  });

  it("sends typed dimensions to the selection", () => {
    const api = apiSpy();
    render(
      <CropControls cropRect={rect} isLoading={false} apiRef={{ current: api }} onApply={vi.fn()} onCancel={vi.fn()} />,
    );

    fireEvent.change(screen.getByLabelText("Width"), { target: { value: "300" } });
    fireEvent.change(screen.getByLabelText("Height"), { target: { value: "200" } });
    fireEvent.change(screen.getByLabelText("Width"), { target: { value: "" } }); // ignoré

    expect(api.setRect).toHaveBeenCalledTimes(2);
    expect(api.setRect).toHaveBeenNthCalledWith(1, { width: 300 });
    expect(api.setRect).toHaveBeenNthCalledWith(2, { height: 200 });
  });

  it("cannot be applied while loading", () => {
    render(<CropControls cropRect={rect} isLoading onApply={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Apply" })).toBeDisabled();
  });
});

describe("CropBar", () => {
  it("follows the store without any re-render of the parent", async () => {
    const store = {
      current: { rect: { x: 0, y: 0, width: 10, height: 10 }, listener: null },
    } as { current: CropStore };
    const onApply = vi.fn();
    render(
      <CropBar store={store} apiRef={{ current: apiSpy() }} isLoading={false} onApply={onApply} onCancel={vi.fn()} />,
    );
    expect(screen.getByLabelText("Width")).toHaveValue(10);

    const next = { x: 5, y: 5, width: 33, height: 44 };
    store.current.rect = next;
    await vi.waitFor(() => expect(store.current.listener).not.toBeNull());
    act(() => store.current.listener?.(next));

    expect(screen.getByLabelText("Width")).toHaveValue(33);
    expect(screen.getByLabelText("Height")).toHaveValue(44);
    await userEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(onApply).toHaveBeenCalledWith(next);
  });

  it("stops listening when it unmounts", () => {
    const store = {
      current: { rect: { x: 0, y: 0, width: 1, height: 1 }, listener: null },
    } as { current: CropStore };
    const { unmount } = render(
      <CropBar store={store} apiRef={{ current: null }} isLoading={false} onApply={vi.fn()} onCancel={vi.fn()} />,
    );
    expect(store.current.listener).not.toBeNull();

    unmount();

    expect(store.current.listener).toBeNull();
  });
});
