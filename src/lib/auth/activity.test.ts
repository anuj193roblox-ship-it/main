import { describe, expect, it } from "vitest";
import { isActivityValid, isRecoveryValid, signActivity, signRecovery } from "./activity";
import { INACTIVITY_LIMIT_MS } from "./session-timing";

const secret = "s".repeat(40);
const t0 = 1_800_000_000_000;

describe("inactivity cookie", () => {
  it("is valid until 30 minutes have passed", async () => {
    const v = await signActivity("u1", t0, secret);
    expect(await isActivityValid(v, "u1", t0 + INACTIVITY_LIMIT_MS - 1, secret)).toBe(true);
    expect(await isActivityValid(v, "u1", t0 + INACTIVITY_LIMIT_MS, secret)).toBe(false);
  });

  it("cannot be moved forward in time, reused for another user or forged", async () => {
    const v = await signActivity("u1", t0, secret);
    const [payload, mac] = [v.slice(0, v.lastIndexOf(".")), v.slice(v.lastIndexOf(".") + 1)];
    const later = payload.replace(String(t0), String(t0 + INACTIVITY_LIMIT_MS));
    expect(await isActivityValid(`${later}.${mac}`, "u1", t0 + INACTIVITY_LIMIT_MS, secret)).toBe(false);
    expect(await isActivityValid(v, "u2", t0, secret)).toBe(false);
    expect(await isActivityValid(v, "u1", t0, "x".repeat(40))).toBe(false);
    expect(await isActivityValid(undefined, "u1", t0, secret)).toBe(false);
    expect(await isActivityValid("garbage", "u1", t0, secret)).toBe(false);
  });

  it("a reset cookie is not an activity cookie, and expires after 15 minutes", async () => {
    const r = await signRecovery("u1", t0, secret);
    expect(await isActivityValid(r, "u1", t0, secret)).toBe(false);
    expect(await isRecoveryValid(r, "u1", t0 + 14 * 60_000, secret)).toBe(true);
    expect(await isRecoveryValid(r, "u1", t0 + 15 * 60_000, secret)).toBe(false);
  });
});
