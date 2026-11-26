import { describe, it, expect } from "vitest";
import { xdr, nativeToScVal } from "@stellar/stellar-sdk";
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

describe("toScVal U32 argument conversion", () => {
  it("converts the minimum value (0) to scvU32", () => {
    const scVal = toScVal({ type: "U32", value: 0 });
    expect(scVal.switch().name).toBe("scvU32");
    expect(scVal.u32()).toBe(0);
  });

  it("converts the maximum value (4294967295) to scvU32", () => {
    const scVal = toScVal({ type: "U32", value: 4294967295 });
    expect(scVal.switch().name).toBe("scvU32");
    expect(scVal.u32()).toBe(4294967295);
  });

  it("matches the Soroban SDK scvU32 encoding at boundary values", () => {
    expect(toScVal({ type: "u32", value: 0 }).toXDR("base64")).toBe(
      xdr.ScVal.scvU32(0).toXDR("base64"),
    );
    expect(toScVal({ type: "u32", value: 4294967295 }).toXDR("base64")).toBe(
      xdr.ScVal.scvU32(4294967295).toXDR("base64"),
    );
  });
});

describe("toScVal I32 argument conversion", () => {
  it("converts the minimum value (-2147483648) to scvI32", () => {
    const scVal = toScVal({ type: "I32", value: -2147483648 });
    expect(scVal.switch().name).toBe("scvI32");
    expect(scVal.i32()).toBe(-2147483648);
  });

  it("converts the maximum value (2147483647) to scvI32", () => {
    const scVal = toScVal({ type: "I32", value: 2147483647 });
    expect(scVal.switch().name).toBe("scvI32");
    expect(scVal.i32()).toBe(2147483647);
  });

  it("matches the Soroban SDK scvI32 encoding at boundary values", () => {
    expect(toScVal({ type: "i32", value: -2147483648 }).toXDR("base64")).toBe(
      xdr.ScVal.scvI32(-2147483648).toXDR("base64"),
    );
    expect(toScVal({ type: "i32", value: 2147483647 }).toXDR("base64")).toBe(
      xdr.ScVal.scvI32(2147483647).toXDR("base64"),
    );
  });
});

describe("toScVal U64 argument conversion", () => {
  it("converts zero (as string) to scvU64", () => {
    const scVal = toScVal({ type: "U64", value: "0" });
    expect(scVal.switch().name).toBe("scvU64");
    expect(scVal.u64().toString()).toBe("0");
  });

  it("converts the maximum value (18446744073709551615) as a string to scvU64", () => {
    const scVal = toScVal({ type: "U64", value: "18446744073709551615" });
    expect(scVal.switch().name).toBe("scvU64");
    expect(scVal.u64().toString()).toBe("18446744073709551615");
  });

  it("matches the Soroban SDK scvU64 encoding at boundary values", () => {
    expect(toScVal({ type: "u64", value: "0" }).toXDR("base64")).toBe(
      nativeToScVal(0n, { type: "u64" }).toXDR("base64"),
    );
    expect(
      toScVal({ type: "u64", value: "18446744073709551615" }).toXDR("base64"),
    ).toBe(
      nativeToScVal(18446744073709551615n, { type: "u64" }).toXDR("base64"),
    );
  });

  it("rejects a non-string value", () => {
    expect(() => toScVal({ type: "u64", value: 42 })).toThrow(
      /must be a string/,
    );
  });

  it("rejects a value exceeding the U64 maximum", () => {
    expect(() =>
      toScVal({ type: "u64", value: "18446744073709551616" }),
    ).toThrow(/out of bounds/);
  });
});

describe("toScVal I128 argument conversion", () => {
  it("converts zero to scvI128 with both high and low equal to 0", () => {
    const scVal = toScVal({ type: "I128", value: "0" });
    expect(scVal.switch().name).toBe("scvI128");
    const parts = scVal.i128();
    expect(parts.lo().toString()).toBe("0");
    expect(parts.hi().toString()).toBe("0");
  });

  it("converts the minimum I128 value: high = -9223372036854775808, low = 0", () => {
    const scVal = toScVal({
      type: "I128",
      value: "-170141183460469231731687303715884105728",
    });
    expect(scVal.switch().name).toBe("scvI128");
    const parts = scVal.i128();
    expect(parts.lo().toString()).toBe("0");
    expect(parts.hi().toString()).toBe("-9223372036854775808");
  });

  it("converts the maximum I128 value: high = 9223372036854775807, low = 18446744073709551615", () => {
    const scVal = toScVal({
      type: "I128",
      value: "170141183460469231731687303715884105727",
    });
    expect(scVal.switch().name).toBe("scvI128");
    const parts = scVal.i128();
    expect(parts.lo().toString()).toBe("18446744073709551615");
    expect(parts.hi().toString()).toBe("9223372036854775807");
  });

  it("decomposes a cross-boundary value (2^64) into high = 1, low = 0", () => {
    const scVal = toScVal({ type: "I128", value: "18446744073709551616" });
    expect(scVal.switch().name).toBe("scvI128");
    const parts = scVal.i128();
    expect(parts.lo().toString()).toBe("0");
    expect(parts.hi().toString()).toBe("1");
  });

  it("matches the Soroban SDK scvI128 encoding at boundary values", () => {
    const minStr = "-170141183460469231731687303715884105728";
    const maxStr = "170141183460469231731687303715884105727";
    expect(toScVal({ type: "i128", value: minStr }).toXDR("base64")).toBe(
      nativeToScVal(BigInt(minStr), { type: "i128" }).toXDR("base64"),
    );
    expect(toScVal({ type: "i128", value: maxStr }).toXDR("base64")).toBe(
      nativeToScVal(BigInt(maxStr), { type: "i128" }).toXDR("base64"),
    );
  });

  it("rejects a non-string value", () => {
    expect(() => toScVal({ type: "i128", value: 100 })).toThrow(
      /must be a string/,
    );
  });

  it("rejects a value exceeding the I128 minimum", () => {
    expect(() =>
      toScVal({
        type: "i128",
        value: "-170141183460469231731687303715884105729",
      }),
    ).toThrow(/out of bounds/);
  });

  it("rejects a value exceeding the I128 maximum", () => {
    expect(() =>
      toScVal({
        type: "i128",
        value: "170141183460469231731687303715884105728",
      }),
    ).toThrow(/out of bounds/);
  });
});
