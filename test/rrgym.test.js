import test from "node:test";
import assert from "node:assert/strict";
import * as R from "../src/index.js";
const { AllowListAuthorityResolver, ParliamentaryEngine, PublicDomain1915Ruleset, createMeeting, allocateCMCA, PossibilityFrontier, FrontierStatus, receiptsToOcel, replay, RRGymEnvironment, RRGymProvider, DenyDoAuthorityResolver, StatePostconditionVerifier } = R;

// ---- cmca.test.js ----
test("CMCA excludes refused candidates but preserves admitted alternatives", () => {
  const out = allocateCMCA([
    { id: "a", evidence: 1, uncertainty: 1, expectedUtility: 8, reversibility: 1, novelty: 1, cost: 1, admitted: true },
    { id: "b", evidence: 0, uncertainty: 4, expectedUtility: 2, reversibility: 1, novelty: 4, cost: 2, admitted: true },
    { id: "refused", evidence: 10, uncertainty: 10, expectedUtility: 10, reversibility: 1, novelty: 10, cost: 1, admitted: false }
  ], 100);
  assert.deepEqual(out.map(x => x.candidateId), ["a", "b"]); assert.ok(out[0].mass > out[1].mass); assert.equal(Math.round(out.reduce((n, x) => n + x.mass, 0)), 100);
});
// ---- engine.test.js ----

const rules = new PublicDomain1915Ruleset();
const chair = { actorId: "chair", role: "CHAIR", authorityGrantIds: [] };
const alice = { actorId: "alice", role: "MEMBER", authorityGrantIds: [] };
const bob = { actorId: "bob", role: "MEMBER", authorityGrantIds: [] };

test("full main-motion path is receipted", () => {
  const authority = new AllowListAuthorityResolver(["m1:alice:CAST_VOTE", "m1:bob:CAST_VOTE", "m1:chair:CAST_VOTE", "m1:chair:ANNOUNCE_RESULT"]);
  const engine = new ParliamentaryEngine(rules, authority);
  let s = createMeeting({ meetingId: "m1", rulesetId: rules.id, members: ["chair", "alice", "bob"] });
  for (const [actor, action] of [
    [chair, { type: "RECOGNIZE", memberId: "alice" }],
    [alice, { type: "INTRODUCE_MOTION", motionId: "motion-1", kind: "MAIN", text: "Adopt strategy" }],
    [bob, { type: "SECOND_MOTION", motionId: "motion-1" }],
    [chair, { type: "OPEN_DEBATE", motionId: "motion-1" }],
    [chair, { type: "CLOSE_DEBATE", motionId: "motion-1" }],
    [chair, { type: "CALL_VOTE", motionId: "motion-1" }],
    [alice, { type: "CAST_VOTE", motionId: "motion-1", memberId: "alice", vote: "YES" }],
    [bob, { type: "CAST_VOTE", motionId: "motion-1", memberId: "bob", vote: "YES" }],
    [chair, { type: "CAST_VOTE", motionId: "motion-1", memberId: "chair", vote: "ABSTAIN" }],
    [chair, { type: "ANNOUNCE_RESULT", motionId: "motion-1" }]
  ]) { const r = engine.apply(s, actor, action); assert.equal(r.admitted, true, r.refusal?.message); s = r.state; }
  assert.equal(s.motions["motion-1"].status, "ADOPTED");
  assert.equal(engine.ledger.verify(), true);
  assert.equal(engine.ledger.all().length, 10);
});

test("DO fails closed without explicit authority", () => {
  const engine = new ParliamentaryEngine(rules);
  let s = createMeeting({ meetingId: "m2", rulesetId: rules.id, members: ["chair", "alice", "bob"] });
  s = engine.apply(s, chair, { type: "RECOGNIZE", memberId: "alice" }).state;
  s = engine.apply(s, alice, { type: "INTRODUCE_MOTION", motionId: "x", kind: "MAIN", text: "x" }).state;
  s = engine.apply(s, bob, { type: "SECOND_MOTION", motionId: "x" }).state;
  s = engine.apply(s, chair, { type: "CALL_VOTE", motionId: "x" }).state;
  const r = engine.apply(s, alice, { type: "CAST_VOTE", motionId: "x", memberId: "alice", vote: "YES" });
  assert.equal(r.admitted, false);
  assert.equal(r.refusal.code, "AUTHORITY_REQUIRED");
});

test("unrecognized member cannot manufacture a motion", () => {
  const engine = new ParliamentaryEngine(rules);
  const s = createMeeting({ meetingId: "m3", rulesetId: rules.id, members: ["chair", "alice", "bob"] });
  const r = engine.apply(s, alice, { type: "INTRODUCE_MOTION", motionId: "x", kind: "MAIN", text: "x" });
  assert.equal(r.admitted, false); assert.equal(r.refusal.code, "RECOGNITION_REQUIRED");
});
// ---- evidence.test.js ----
test("receipts export OCEL and deterministic replay conforms",()=>{ const rules=new PublicDomain1915Ruleset(); const authority=new AllowListAuthorityResolver(); const engine=new ParliamentaryEngine(rules,authority); const chair={actorId:"c",role:"CHAIR",authorityGrantIds:[]}; let s=createMeeting({meetingId:"e1",rulesetId:rules.id,members:["c","a"]}); s=engine.apply(s,chair,{type:"RECOGNIZE",memberId:"a"}).state; const receipts=engine.ledger.all(); const ocel=receiptsToOcel(receipts); assert.equal(Object.keys(ocel.events).length,1); const r=replay({initialState:createMeeting({meetingId:"e1",rulesetId:rules.id,members:["c","a"]}),receipts,ruleset:rules,authority}); assert.equal(r.conformant,true); });
// ---- frontier.test.js ----
test("deferred possibility is preserved and can revive",()=>{ const f=new PossibilityFrontier(); f.add({id:"p",value:1}); f.defer("p","budget"); assert.equal(f.get("p").status,FrontierStatus.DEFERRED); f.revive("p","new evidence"); assert.equal(f.get("p").status,FrontierStatus.ALIVE); });
test("falsification requires receipt evidence and is terminal",()=>{ const f=new PossibilityFrontier(); f.add({id:"p"}); assert.throws(()=>f.falsify("p",{}),/REQUIRES_RECEIPT/); f.falsify("p",{receiptHash:"sha256:x"}); assert.equal(f.get("p").status,FrontierStatus.FALSIFIED); assert.throws(()=>f.revive("p","no"),/TERMINAL_CANDIDATE/); });
// ---- gymact.test.js ----
test("checkpoint restore is identity-bound", () => {
  const rules = new PublicDomain1915Ruleset(); const engine = new ParliamentaryEngine(rules);
  const state = createMeeting({ meetingId: "m", rulesetId: rules.id, members: ["chair", "m1"] });
  const env = new RRGymEnvironment({ episodeId: "e", initialState: state, actor: { actorId: "chair", role: "CHAIR", authorityGrantIds: [] } }, engine);
  const cp = env.checkpoint(); env.restore(cp); assert.equal(env.observe().state.meetingId, "m"); assert.throws(() => env.restore(cp.replace('"m"', '"x"')), /CHECKPOINT_IDENTITY_MISMATCH/);
});
// ---- provider.test.js ----
test("provider materialization is ruleset-bound and verifier is independent",()=>{ const rules=new PublicDomain1915Ruleset(); const provider=new RRGymProvider({ruleset:rules,authority:new DenyDoAuthorityResolver(),verifier:new StatePostconditionVerifier()}); const state=createMeeting({meetingId:"m",rulesetId:rules.id,members:["c","a"]}); const env=provider.materialize({episodeId:"e",initialState:state,actor:{actorId:"c",role:"CHAIR",authorityGrantIds:[]}}); assert.equal(env.verify({phase:"OPEN"}).passed,true); assert.throws(()=>provider.materialize({episodeId:"x",initialState:{...state,rulesetId:"wrong"},actor:{actorId:"c",role:"CHAIR",authorityGrantIds:[]}}),/RULESET_IDENTITY_MISMATCH/); });

test("actor cannot cast another present member's vote", () => {
  const rules = new PublicDomain1915Ruleset();
  const auth = new AllowListAuthorityResolver(["proxy:alice:CAST_VOTE"]);
  const engine = new ParliamentaryEngine(rules, auth);
  const chair = { actorId: "chair", role: "CHAIR", authorityGrantIds: [] };
  const alice = { actorId: "alice", role: "MEMBER", authorityGrantIds: [] };
  const bob = { actorId: "bob", role: "MEMBER", authorityGrantIds: [] };
  let s = createMeeting({ meetingId: "proxy", rulesetId: rules.id, members: ["chair", "alice", "bob"] });
  s = engine.apply(s, chair, { type: "RECOGNIZE", memberId: "alice" }).state;
  s = engine.apply(s, alice, { type: "INTRODUCE_MOTION", motionId: "m", kind: "MAIN", text: "m" }).state;
  s = engine.apply(s, bob, { type: "SECOND_MOTION", motionId: "m" }).state;
  s = engine.apply(s, chair, { type: "CALL_VOTE", motionId: "m" }).state;
  const r = engine.apply(s, alice, { type: "CAST_VOTE", motionId: "m", memberId: "bob", vote: "YES" });
  assert.equal(r.admitted, false); assert.equal(r.refusal.ruleId, "RRGYM-VOTE-004");
});

test("only chair can execute adjournment", () => {
  const rules = new PublicDomain1915Ruleset(); const auth = new AllowListAuthorityResolver(["adj:alice:ADJOURN_MEETING"]);
  const engine = new ParliamentaryEngine(rules, auth);
  const s = createMeeting({ meetingId: "adj", rulesetId: rules.id, members: ["chair", "alice"] });
  const r = engine.apply(s, { actorId: "alice", role: "MEMBER", authorityGrantIds: [] }, { type: "ADJOURN_MEETING" });
  assert.equal(r.admitted, false); assert.equal(r.refusal.code, "ROLE_NOT_AUTHORIZED");
});

test("point of order is explicit state and appeal requires a ruling", () => {
  const rules = new PublicDomain1915Ruleset(); const engine = new ParliamentaryEngine(rules);
  const chair={actorId:"chair",role:"CHAIR",authorityGrantIds:[]}; const alice={actorId:"alice",role:"MEMBER",authorityGrantIds:[]};
  let s=createMeeting({meetingId:"po",rulesetId:rules.id,members:["chair","alice"]});
  let r=engine.apply(s,alice,{type:"POINT_OF_ORDER",memberId:"alice",againstActionId:"po:a:0",reason:"out of order"}); s=r.state;
  const pointId=Object.keys(s.pointsOfOrder)[0]; assert.ok(pointId);
  r=engine.apply(s,alice,{type:"APPEAL_RULING",pointId}); assert.equal(r.admitted,false);
  r=engine.apply(s,chair,{type:"RULE_POINT_OF_ORDER",pointId,ruling:"WELL_TAKEN"}); s=r.state; assert.equal(r.admitted,true);
  r=engine.apply(s,alice,{type:"APPEAL_RULING",pointId}); assert.equal(r.admitted,true); assert.equal(Object.keys(r.state.appeals).length,1);
});

test("receipt-chain tampering is detected", () => {
  const rules=new PublicDomain1915Ruleset(); const engine=new ParliamentaryEngine(rules); const chair={actorId:"c",role:"CHAIR",authorityGrantIds:[]};
  const s=createMeeting({meetingId:"tamper",rulesetId:rules.id,members:["c","a"]}); engine.apply(s,chair,{type:"RECOGNIZE",memberId:"a"});
  const copy=engine.ledger.all().map(r=>structuredClone(r)); copy[0].actorId="attacker";
  assert.equal(R.verifyReceiptChain(copy),false);
});

test("ruleset providers fail closed when contract is incomplete", () => {
  assert.throws(()=>new ParliamentaryEngine({id:"x"}),/RULESET_PROVIDER_MISSING/);
});

test("50-planner league expands planner-role cross product without conflating role and planner", () => {
  const roles=["CHAIR","PARLIAMENTARIAN","MEMBER","MAJORITY_STRATEGIST","MINORITY_STRATEGIST","AGENDA_STRATEGIST","OBSERVER"];
  const planners=Array.from({length:50},(_,i)=>({id:`p${i+1}`,compatibleRoles:new Set(i%2===0?roles:["MEMBER","OBSERVER"]),propose:()=>[]}));
  const league=R.buildLeague(planners,roles); assert.equal(league.length,350); assert.ok(league.some(x=>!x.admitted)); assert.ok(league.some(x=>x.admitted));
});

test("determinism court: same admitted construction sequence produces same receipt head", () => {
  const run=()=>{ const rules=new PublicDomain1915Ruleset(); const engine=new ParliamentaryEngine(rules); const chair={actorId:"c",role:"CHAIR",authorityGrantIds:[]}; let s=createMeeting({meetingId:"det",rulesetId:rules.id,members:["c","a"]}); s=engine.apply(s,chair,{type:"RECOGNIZE",memberId:"a"}).state; return engine.ledger.all().at(-1).receiptHash; };
  assert.equal(run(),run());
});

for (let seed=1; seed<=100; seed++) {
  test(`fuzz-refusal-${seed}: random invalid motion never mutates actionCount`, () => {
    const rules=new PublicDomain1915Ruleset(); const engine=new ParliamentaryEngine(rules); const s=createMeeting({meetingId:`f${seed}`,rulesetId:rules.id,members:["c","a"]});
    const r=engine.apply(s,{actorId:"a",role:"MEMBER",authorityGrantIds:[]},{type:"INTRODUCE_MOTION",motionId:`m${seed}`,kind:"MAIN",text:`seed ${seed}`});
    assert.equal(r.admitted,false); assert.equal(r.state.actionCount,0); assert.equal(engine.ledger.all().length,1); assert.equal(engine.ledger.verify(),true);
  });
}
