import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { isVertical916, SAFE_ZONE_PLATFORMS, safeZoneOf } from "./platforms";
import { useSafeZone } from "./useSafeZone";

describe("zones sûres", () => {
  beforeEach(() => localStorage.clear());

  it("laisse toujours une surface utile au centre", () => {
    for (const { safe } of SAFE_ZONE_PLATFORMS) {
      expect(safe.top + safe.bottom).toBeLessThan(0.5);
      expect(safe.left + safe.right).toBeLessThan(0.5);
    }
    expect(safeZoneOf("tiktok")?.bottom).toBe(0.22);
    expect(safeZoneOf(null)).toBeNull();
  });

  it("ne vaut que pour une image 9:16", () => {
    expect(isVertical916(1080, 1920)).toBe(true);
    expect(isVertical916(608, 1080)).toBe(true);
    expect(isVertical916(1920, 1080)).toBe(false);
    expect(isVertical916(1080, 1350)).toBe(false);
    expect(isVertical916(0, 0)).toBe(false);
  });

  it("retient la plateforme choisie et ignore une valeur inconnue", () => {
    const first = renderHook(() => useSafeZone());
    act(() => first.result.current[1]("reels"));
    expect(renderHook(() => useSafeZone()).result.current[0]).toBe("reels");

    act(() => first.result.current[1]("myspace"));
    expect(first.result.current[0]).toBeNull();
  });
});
