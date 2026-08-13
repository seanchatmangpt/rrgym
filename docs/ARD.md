# rrgym v26.8.12 — Architecture Requirements Document

## Constitutional separation
```text
AutoFDE-Lab / Planner of Planners -> policies
CMCA                              -> compute allocation
rrgym                             -> parliamentary world law
GymAct                            -> bounded episode/evidence execution
ggen                              -> graph-derived static projections
BRCE / authority resolver         -> consequential permission
receipts                           -> observed lineage
```

`Planner != Policy != Role != Agent`. `Allocation != Authority`. `Simulation != Consequence`.

## Core state
`MeetingState = identity × ruleset × quorum × recognition × motion graph × votes × phase`.

## Transition law
`Admit(state, actor, action) -> ADMITTED | REFUSED(reason)` followed by a deterministic state reducer. A refused transition never mutates world state but still emits a refusal receipt.

## Consequence classes
- READ: observation only.
- CONSTRUCT: reversible institutional construction (recognition, motions, debate/vote state).
- DO: consequential disposition/commitment surfaces; default denied without explicit authority.

## Ruleset provider boundary
The engine never hardcodes modern RONR text. `Ruleset` is a pluggable procedural authority. v26.8.12 ships an independently encoded 1915 public-domain seed only. Licensed/current authorities may implement the same provider interface out of tree.

## Evidence
Every attempt yields a canonical receipt containing actor, role, action, consequence, admission/refusal, state digest, prior receipt digest, and current receipt digest. Production ecosystem integration should swap/augment the bootstrap SHA-256 transport digest with the ecosystem's canonical BLAKE3 receipt implementation.

## DfCM / CMCA
Potential parliamentary trajectories remain represented independently of simulation allocation. CMCA allocates budget only across admitted candidates and cannot authorize `DO`.

## GymAct adapter
`RRGymEnvironment` provides `observe`, `act`, independent-state `verify`, `checkpoint`, and identity-bound `restore`. Full GymAct integration must preserve its existing injected AuthorityResolver/PostconditionVerifier/OCEL contracts instead of creating an alternate authority stack.

## Threat model
- malicious planner submits out-of-order motion;
- planner attempts unauthorized disposition;
- duplicate/phantom vote;
- checkpoint replay into another meeting;
- provider reports success dishonestly;
- receipt-chain tampering;
- governance rule drift;
- copyrighted current rules embedded without license.
All fail closed or are explicitly outside claim scope.
