#!/usr/bin/env node
import { PublicDomain1915Ruleset, ParliamentaryEngine, createMeeting, AllowListAuthorityResolver, receiptsToOcel } from "../src/index.js";

const command = process.argv[2] ?? "doctor";
if (command === "doctor") {
  const rules = new PublicDomain1915Ruleset();
  const engine = new ParliamentaryEngine(rules);
  const state = createMeeting({ meetingId: "doctor", rulesetId: rules.id, members: ["chair", "member"] });
  const r = engine.apply(state, { actorId: "chair", role: "CHAIR", authorityGrantIds: [] }, { type: "RECOGNIZE", memberId: "member" });
  console.log(JSON.stringify({ version: "26.8.12", ruleset: rules.id, admitted: r.admitted, receiptChainValid: engine.ledger.verify(), ambientDo: "DENY", standing: "LOCAL_COURT_ALIVE" }, null, 2));
} else if (command === "demo") {
  const rules = new PublicDomain1915Ruleset();
  const authority = new AllowListAuthorityResolver(["demo:alice:CAST_VOTE", "demo:bob:CAST_VOTE", "demo:chair:CAST_VOTE", "demo:chair:ANNOUNCE_RESULT"]);
  const engine = new ParliamentaryEngine(rules, authority);
  const chair={actorId:"chair",role:"CHAIR",authorityGrantIds:[]}, alice={actorId:"alice",role:"MEMBER",authorityGrantIds:[]}, bob={actorId:"bob",role:"MEMBER",authorityGrantIds:[]};
  let state=createMeeting({meetingId:"demo",rulesetId:rules.id,members:["chair","alice","bob"]});
  const sequence=[[chair,{type:"RECOGNIZE",memberId:"alice"}],[alice,{type:"INTRODUCE_MOTION",motionId:"m1",kind:"MAIN",text:"Adopt the architecture"}],[bob,{type:"SECOND_MOTION",motionId:"m1"}],[chair,{type:"CALL_VOTE",motionId:"m1"}],[alice,{type:"CAST_VOTE",motionId:"m1",memberId:"alice",vote:"YES"}],[bob,{type:"CAST_VOTE",motionId:"m1",memberId:"bob",vote:"YES"}],[chair,{type:"CAST_VOTE",motionId:"m1",memberId:"chair",vote:"ABSTAIN"}],[chair,{type:"ANNOUNCE_RESULT",motionId:"m1"}]];
  for (const [actor,action] of sequence) state=engine.apply(state,actor,action).state;
  console.log(JSON.stringify({ state, receipts: engine.ledger.all(), ocel: receiptsToOcel(engine.ledger.all()) }, null, 2));
} else {
  console.error(`REFUSED:UNKNOWN_COMMAND:${command}`); process.exitCode=2;
}
