# rrgym

**Robert's Rules of Order Gym — executable governance for planner leagues.**

`rrgym` turns parliamentary procedure into a deterministic, receipted world. Planners may propose and navigate lawful actions; they never gain ambient authority merely by being intelligent.

```js
import { PublicDomain1915Ruleset, ParliamentaryEngine, createMeeting } from "rrgym";
const rules = new PublicDomain1915Ruleset();
const engine = new ParliamentaryEngine(rules); // DO is denied by default
const state = createMeeting({ meetingId: "board-1", rulesetId: rules.id, members: ["chair", "a", "b"] });
```

## Ecosystem contract
- **rrgym**: world law and parliamentary transitions
- **GymAct**: episode execution, independent observation/verification, OCEL/evidence
- **AutoFDE-Lab**: planner league / Planner of Planners
- **CMCA**: bounded allocation over the DfCM possibility frontier
- **ggen**: semantic manufacture of static contracts
- **BRCE**: no unreceipted consequential actuation

## Rules authority boundary
The official Robert's Rules site states that RONR 12th edition is the current official authority and that editions published in 1915 or earlier are out of copyright. This repository therefore ships only an independently encoded **1915 public-domain research seed**, not current RONR text. Production/current-RONR claims require an appropriately licensed provider.

## Validation
`npm test`

## Standing
v26.8.12 bootstrap kernel: source-level courts can become ALIVE only after exact-head execution. Current-RONR compliance: **UNKNOWN / not claimed**.
