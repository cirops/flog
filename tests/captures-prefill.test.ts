import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { prefillFromRaw } from "../src/captures/prefill.js";

describe("prefillFromRaw", () => {
  it("prefills id and cleaned description from git checkout -b with trailing ticket", () => {
    const result = prefillFromRaw("git checkout -b feature/icms-ui_tax4b_120999");
    assert.equal(result.id, "120999");
    assert.equal(result.description, "icms-ui tax4b");
  });

  it("leaves id empty when no ticket-like numeric token is present", () => {
    const result = prefillFromRaw("git switch -c feature/quick-fix");
    assert.equal(result.id, "");
    assert.equal(result.description, "quick-fix");
  });

  it("uses full raw as description for non-git commands", () => {
    const result = prefillFromRaw("t14ss -b something_999");
    assert.equal(result.id, "999");
    assert.equal(result.description, "t14ss -b something_999");
  });
});
