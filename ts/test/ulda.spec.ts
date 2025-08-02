import { describe, expect, it } from "vitest";
import UldaSign from '../src/ulda-sign'; 


describe("UldaSign", () => {
  it("generates a signature", async () => {
    const us = new UldaSign();
    const sig = await us.sign(new Uint8Array([1,2,3]));
    expect(sig).toBeTypeOf("string");
  });
});
