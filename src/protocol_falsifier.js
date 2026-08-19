export function falsifyParliamentaryProtocol({
  expectedRefusal = null,
  actualCode,
  before,
  after,
  consequential = false,
  receiptPresent = false,
}) {
  if (expectedRefusal !== null) {
    if (actualCode !== expectedRefusal) return Object.freeze({ conforms: false, code: "FALSIFIED:WRONG_REFUSAL" });
    if (JSON.stringify(before) !== JSON.stringify(after)) {
      return Object.freeze({ conforms: false, code: "FALSIFIED:REFUSED_PATH_CHANGED_WORLD" });
    }
    return Object.freeze({ conforms: true, code: "CONFORMS:REFUSAL" });
  }
  if (consequential && !receiptPresent) {
    return Object.freeze({ conforms: false, code: "FALSIFIED:UNRECEIPTED_CONSEQUENCE" });
  }
  return Object.freeze({ conforms: true, code: "CONFORMS:CONSEQUENCE" });
}
