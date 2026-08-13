# rrgym v26.8.12 — Product Requirements Document

## Product thesis
`rrgym` makes governance executable. It converts parliamentary procedure into a bounded state-transition world in which heterogeneous planners can compete, collaborate, red-team, and be evaluated without acquiring ambient real-world authority.

## Customer
Fortune-5 boards, architecture review boards, technical steering committees, compliance/governance teams, AI platform teams, institutional researchers, and benchmark authors.

## Jobs to be done
1. Reproduce a governed meeting as a deterministic episode.
2. Evaluate planner policies under typed roles and information partitions.
3. Compare governance rulesets as experimental variables.
4. Red-team agenda control, deadlock, manipulation, premature closure, and minority suppression.
5. Preserve a DfCM possibility frontier while CMCA allocates finite simulation budget.
6. Produce tamper-evident receipts for every admitted/refused transition.
7. Export bounded GymAct-compatible observations/actions without granting deployment authority.

## Non-goals
- Replace a parliamentarian or provide legal advice.
- Redistribute copyrighted current RONR text.
- Let an LLM/planner self-authorize consequential action.
- Treat realistic simulation as proof of organizational authority.

## v26.8.12 acceptance
- Deterministic parliamentary kernel for a public-domain 1915 seed ruleset.
- Typed motion/action/refusal vocabulary.
- Quorum, recognition, second, debate, vote, threshold, result, and precedence gates.
- Default-deny DO authority resolver and explicit allow-list resolver.
- Hash-chained receipts and replay verification.
- GymAct-facing environment contract with observe/act/verify/checkpoint/restore.
- Planner-role compatibility admission.
- CMCA allocation reference implementation.
- Governance metrics reference implementation.
- Public-ontology ABox and ggen manufacturing pack.
- CI courts and security/licensing documentation.

## SLO / quality gates
- 100% deterministic replay for identical state/action sequence.
- 0 ambient DO authority paths.
- 0 untyped refusals from the kernel.
- Every transition emits exactly one receipt.
- Receipt-chain corruption is detected.
- Unknown motion/action/ruleset semantics fail closed.

## Claim ceiling
The built-in 1915 seed is a research ruleset, not current RONR compliance. A licensed/current authority provider must be independently supplied for claims involving current RONR.
