import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

async function renderStyle() {
  const { default: StylePage } = await import("./page");
  return StylePage();
}

describe("/style is hidden in production unless NEXT_PUBLIC_DEMO_MODE is true", () => {
  it("returns not found in production with demo mode unset", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", "");
    await expect(renderStyle()).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it.each(["false", "1", "TRUE", "yes"])("returns not found in production when demo mode is %j", async (value) => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", value);
    await expect(renderStyle()).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("renders in production when demo mode is exactly true", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", "true");
    await expect(renderStyle()).resolves.toBeTruthy();
  });

  it("renders in development without demo mode", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", "");
    await expect(renderStyle()).resolves.toBeTruthy();
  });
});
