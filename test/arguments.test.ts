import { describe, it, expect } from "vitest";
import { xdr } from "@stellar/stellar-sdk";
import { toScVal } from "../src/measurement";

/** Encode and decode through XDR so the assertion checks the wire content. */
function roundTripString(value: string): {
  discriminator: string;
  bytes: Buffer;
} {
  const scVal = toScVal({ type: "String", value });
  const decoded = xdr.ScVal.fromXDR(scVal.toXDR());
  return {
    discriminator: scVal.switch().name,
    bytes: Buffer.from(decoded.str()),
  };
}

describe("toScVal String argument conversion", () => {
  it.each([
    ["a short string", "hello world"],
    ["an empty string", ""],
    ["a single character", "a"],
    ["a long string", "soroban ".repeat(512)],
    ["UTF-8 characters", "héllo wörld — 你好, 🌍"],
  ])("converts %s to scvString with identical content", (_label, value) => {
    const { discriminator, bytes } = roundTripString(value);
    expect(discriminator).toBe("scvString");
    expect(bytes.toString("utf8")).toBe(value);
    expect(bytes.length).toBe(Buffer.byteLength(value, "utf8"));
  });

  it("matches the Soroban SDK scvString encoding", () => {
    const value = "hello world";
    expect(toScVal({ type: "String", value }).toXDR("base64")).toBe(
      xdr.ScVal.scvString(value).toXDR("base64"),
    );
  });

  it("encodes multi-byte UTF-8 characters by byte length", () => {
    const { bytes } = roundTripString("🌍");
    expect(bytes.length).toBe(4);
    expect(bytes.equals(Buffer.from([0xf0, 0x9f, 0x8c, 0x8d]))).toBe(true);
  });

  it("treats the type name case-insensitively", () => {
    for (const type of ["String", "string", "STRING"]) {
      expect(toScVal({ type, value: "hello world" }).switch().name).toBe(
        "scvString",
      );
    }
  });
});
