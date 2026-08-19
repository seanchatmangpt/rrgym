import test from "node:test";
import assert from "node:assert/strict";
import { falsifyParliamentaryProtocol } from "../src/protocol_falsifier.js";
import { DenyDoAuthorityResolver } from "../src/index.js";

test("existing authority resolver refusal is inert and conformant", () => {
  const before = { meetingId: "m", motions: {} };
  const resolver = new DenyDoAuthorityResolver();
  const refusal = resolver.authorize(before, { actorId: "member" }, { type: "CAST_VOTE" }, "DO");
  const result = falsifyParliamentaryProtocol({
    expectedRefusal: `REFUSED:${refusal.code}`,
    actualCode: `REFUSED:${refusal.code}`,
    before,
    after: structuredClone(before),
  });
  assert.deepEqual(result, { conforms: true, code: "CONFORMS:REFUSAL" });
});

test("refusal that mutates parliamentary state is falsified", () => {
  const result = falsifyParliamentaryProtocol({
    expectedRefusal: "REFUSED:AUTHORITY_REQUIRED",
    actualCode: "REFUSED:AUTHORITY_REQUIRED",
    before: { votes: [] },
    after: { votes: ["YES"] },
  });
  assert.deepEqual(result, { conforms: false, code: "FALSIFIED:REFUSED_PATH_CHANGED_WORLD" });
});

test("consequential parliamentary transition requires receipt", () => {
  const result = falsifyParliamentaryProtocol({
    actualCode: "ALLOWED",
    before: { status: "VOTING" },
    after: { status: "ADOPTED" },
    consequential: true,
    receiptPresent: false,
  });
  assert.deepEqual(result, { conforms: false, code: "FALSIFIED:UNRECEIPTED_CONSEQUENCE" });
});
