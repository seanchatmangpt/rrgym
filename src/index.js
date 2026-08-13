import { createHash } from "node:crypto";

export function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value)
    .filter(([, current]) => current !== undefined)
    .sort(([left], [right]) => left.localeCompare(right));
  return `{${entries.map(([key, current]) => `${JSON.stringify(key)}:${canonicalJson(current)}`).join(",")}}`;
}

export function digest(value) {
  return `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
}

export function verifyReceiptChain(receipts) {
  let prior = null;
  for (const receipt of receipts) {
    const { receiptHash, ...unsigned } = receipt;
    if (receipt.priorHash !== prior || digest(unsigned) !== receiptHash) return false;
    prior = receiptHash;
  }
  return true;
}

export class ReceiptLedger {
  #receipts = [];

  append(input) {
    const sequence = this.#receipts.length + 1;
    const priorHash = this.#receipts.at(-1)?.receiptHash ?? null;
    const unsigned = {
      schema: "urn:rrgym:receipt:v1",
      receiptId: `${input.meetingId}:${sequence}`,
      sequence,
      priorHash,
      ...input,
    };
    const receipt = Object.freeze({ ...unsigned, receiptHash: digest(unsigned) });
    this.#receipts.push(receipt);
    return receipt;
  }

  all() {
    return Object.freeze([...this.#receipts]);
  }

  verify() {
    return verifyReceiptChain(this.#receipts);
  }
}

const MOTION_RULES = Object.freeze({
  MAIN: { secondRequired: true, debatable: true, amendable: true, voteThreshold: "MAJORITY", precedence: 10 },
  AMEND: { secondRequired: true, debatable: true, amendable: true, voteThreshold: "MAJORITY", precedence: 30 },
  REFER: { secondRequired: true, debatable: true, amendable: true, voteThreshold: "MAJORITY", precedence: 40 },
  POSTPONE_DEFINITELY: { secondRequired: true, debatable: true, amendable: true, voteThreshold: "MAJORITY", precedence: 50 },
  PREVIOUS_QUESTION: { secondRequired: true, debatable: false, amendable: false, voteThreshold: "TWO_THIRDS", precedence: 80 },
  ADJOURN: { secondRequired: true, debatable: false, amendable: false, voteThreshold: "MAJORITY", precedence: 100 },
  RECONSIDER: { secondRequired: true, debatable: true, amendable: false, voteThreshold: "MAJORITY", precedence: 20 },
  RESCIND: { secondRequired: true, debatable: true, amendable: true, voteThreshold: "TWO_THIRDS", precedence: 20 },
});

const refusal = (code, message, ruleId) => Object.freeze({ code, message, ruleId });
const pending = state => {
  const id = state.pendingMotionIds.at(-1);
  return id ? state.motions[id] : undefined;
};

export function assertRulesetProvider(provider) {
  for (const key of ["id", "source", "authorityClass"]) {
    if (typeof provider?.[key] !== "string") throw new TypeError(`REFUSED:RULESET_PROVIDER_MISSING:${key}`);
  }
  for (const method of ["motionRule", "validate"]) {
    if (typeof provider?.[method] !== "function") throw new TypeError(`REFUSED:RULESET_PROVIDER_MISSING:${method}`);
  }
  return provider;
}

export class PublicDomain1915Ruleset {
  id = "urn:rrgym:ruleset:public-domain:1915-seed:v1";
  source = "Henry M. Robert, Rules of Order Revised, 4th ed. (1915); independently encoded procedural seed; not a substitute for current RONR.";
  authorityClass = "PUBLIC_DOMAIN_SEED";

  motionRule(kind) {
    const rule = MOTION_RULES[kind];
    if (!rule) throw new Error(`REFUSED:UNKNOWN_MOTION_KIND:${kind}`);
    return rule;
  }

  validate(state, actor, action) {
    if (state.phase !== "OPEN") return refusal("MEETING_ADJOURNED", "Meeting is not open.", "RRGYM-STATE-001");
    if (state.present.length < state.quorum) return refusal("QUORUM_NOT_MET", "Quorum is not present.", "RRGYM-QUORUM-001");

    const chairOnly = new Set([
      "RECOGNIZE",
      "OPEN_DEBATE",
      "CLOSE_DEBATE",
      "CALL_VOTE",
      "ANNOUNCE_RESULT",
      "RULE_POINT_OF_ORDER",
      "ADJOURN_MEETING",
    ]);
    if (chairOnly.has(action.type) && actor.role !== "CHAIR") {
      return refusal("ROLE_NOT_AUTHORIZED", `${action.type} requires CHAIR.`, "RRGYM-ROLE-001");
    }

    if (action.type === "INTRODUCE_MOTION") {
      if (["OBSERVER", "PARLIAMENTARIAN"].includes(actor.role)) {
        return refusal("ROLE_NOT_AUTHORIZED", "Role may not introduce motions.", "RRGYM-ROLE-002");
      }
      if (state.recognizedMemberId !== actor.actorId) {
        return refusal("RECOGNITION_REQUIRED", "Member must be recognized before introducing a motion.", "RRGYM-RECOGNITION-001");
      }
      const current = pending(state);
      if (
        current
        && action.kind !== "AMEND"
        && this.motionRule(action.kind).precedence <= this.motionRule(current.kind).precedence
      ) {
        return refusal("MOTION_OUT_OF_ORDER", "Motion lacks precedence over pending question.", "RRGYM-PRECEDENCE-001");
      }
      if (action.kind === "AMEND") {
        if (!action.parentMotionId || !state.motions[action.parentMotionId]) {
          return refusal("MOTION_OUT_OF_ORDER", "Amendment requires an existing parent motion.", "RRGYM-AMEND-001");
        }
        if (!this.motionRule(state.motions[action.parentMotionId].kind).amendable) {
          return refusal("MOTION_OUT_OF_ORDER", "Parent motion is not amendable.", "RRGYM-AMEND-002");
        }
      }
    }

    if (action.type === "RULE_POINT_OF_ORDER" || action.type === "APPEAL_RULING") {
      const point = state.pointsOfOrder?.[action.pointId];
      if (!point) return refusal("MOTION_NOT_FOUND", `Unknown point of order ${action.pointId}.`, "RRGYM-POINT-404");
      if (action.type === "APPEAL_RULING" && point.status === "PENDING") {
        return refusal("RESULT_NOT_READY", "A pending point cannot be appealed before the chair rules.", "RRGYM-APPEAL-001");
      }
    }

    if (action.motionId && action.type !== "INTRODUCE_MOTION") {
      const motion = state.motions[action.motionId];
      if (!motion) return refusal("MOTION_NOT_FOUND", `Unknown motion ${action.motionId}.`, "RRGYM-MOTION-404");
      const rule = this.motionRule(motion.kind);
      if (action.type === "SECOND_MOTION" && !rule.secondRequired) {
        return refusal("MOTION_NOT_SECONDABLE", "Motion does not require a second.", "RRGYM-SECOND-002");
      }
      if (action.type === "SECOND_MOTION" && actor.actorId === motion.makerId) {
        return refusal("MOTION_NOT_SECONDABLE", "Maker may not second own motion in this seed model.", "RRGYM-SECOND-003");
      }
      if (action.type === "OPEN_DEBATE") {
        if (!rule.debatable) return refusal("DEBATE_NOT_ALLOWED", `${motion.kind} is not debatable.`, "RRGYM-DEBATE-001");
        if (rule.secondRequired && !motion.secondedBy) return refusal("SECOND_REQUIRED", "Second required before debate.", "RRGYM-SECOND-001");
        if (motion.status === "DEBATING") return refusal("DEBATE_ALREADY_OPEN", "Debate is already open.", "RRGYM-DEBATE-002");
      }
      if (action.type === "CLOSE_DEBATE" && motion.status !== "DEBATING") {
        return refusal("DEBATE_NOT_OPEN", "Debate is not open.", "RRGYM-DEBATE-003");
      }
      if (action.type === "CALL_VOTE" && rule.secondRequired && !motion.secondedBy) {
        return refusal("SECOND_REQUIRED", "Second required before vote.", "RRGYM-SECOND-001");
      }
      if (action.type === "CAST_VOTE") {
        if (motion.status !== "VOTING") return refusal("VOTE_NOT_OPEN", "Vote is not open.", "RRGYM-VOTE-001");
        if (!state.present.includes(action.memberId)) return refusal("ROLE_NOT_AUTHORIZED", "Only present members may vote.", "RRGYM-VOTE-003");
        if (actor.actorId !== action.memberId) return refusal("ROLE_NOT_AUTHORIZED", "An actor may only cast its own vote in the core ruleset.", "RRGYM-VOTE-004");
        if (motion.votes[action.memberId]) return refusal("DUPLICATE_VOTE", "Member already voted.", "RRGYM-VOTE-002");
      }
      if (action.type === "ANNOUNCE_RESULT") {
        if (motion.status !== "VOTING") return refusal("RESULT_NOT_READY", "Motion is not in voting state.", "RRGYM-RESULT-001");
        if (Object.keys(motion.votes).length < state.present.length) {
          return refusal("RESULT_NOT_READY", "All present members must have a recorded vote or abstention in this seed model.", "RRGYM-RESULTE-002");
        }
      }
    }

    return null;
  }
}

export class DenyDoAuthorityResolver {
  authorize(_state, _actor, _action, consequence) {
    return consequence === "DO"
      ? refusal("AUTHORITY_REQUIRED", "DO requires explicit authority.", "RRGYM-BRCE-001")
      : null;
  }
}

export class AllowListAuthorityResolver {
  constructor(grants = []) {
    this.grants = new Set(grants);
  }

  add(grant) {
    this.grants.add(grant);
  }

  authorize(state, actor, action, consequence) {
    if (consequence !== "DO") return null;
    const grant = `${state.meetingId}:${actor.actorId}:${action.type}`;
    return this.grants.has(grant)
      ? null
      : refusal("AUTHORITY_REQUIRED", `Missing explicit grant ${grant}.`, "RRGYM-BRCE-001");
  }
}

export class StatePostconditionVerifier {
  verify(observation, expected) {
    const state = observation.state;
    const failures = [];
    if (expected.phase !== undefined && state.phase !== expected.phase) failures.push(`phase:${state.phase}!=${expected.phase}`);
    if (expected.pendingMotionIds !== undefined && JSON.stringify(state.pendingMotionIds) !== JSON.stringify(expected.pendingMotionIds)) failures.push("pendingMotionIds:mismatch");
    if (expected.motionStatus) {
      for (const [id, status] of Object.entries(expected.motionStatus)) {
        if (state.motions[id]?.status !== status) failures.push(`motion:${id}:${state.motions[id]?.status ?? "MISSING"}!=${status}`);
      }
    }
    return Object.freeze({ passed: failures.length === 0, failures: Object.freeze(failures) });
  }
}

export function createMeeting({ meetingId, rulesetId, members, present = members, quorum = Math.floor(members.length / 2) + 1 }) {
  return Object.freeze({ meetingId, rulesetId, phase: "OPEN", members: [...members], present: [...present], quorum, recognizedMemberId: null, motions: {}, pendingMotionIds: [], pointsOfOrder: {}, appeals: {}, actionCount: 0 });
}

const DO_ACTIONS = new Set(["CAST_VOTE", "ANNOUNCE_RESULT", "ADJOURN_MEETING"]);
const READ_ACTIONS = new Set(["OBSERVE"]);

export function consequenceOf(action) {
  if (DO_ACTIONS.has(action.type)) return "DO";
  if (READ_ACTIONS.has(action.type)) return "READ";
  return "CONSTRUCT";
}

function cloneState(state) {
  return structuredClone(state);
}

function freezeState(state) {
  for (const motion of Object.values(state.motions)) Object.freeze(motion.votes);
  return Object.freeze(state);
}

function votePassed(rule, votes) {
  const values = Object.values(votes);
  const yes = values.filter(vote => vote === "YES").length;
  const no = values.filter(vote => vote === "NO").length;
  if (rule.voteThreshold === "TWO_THIRDS") return yes > 0 && yes * 3 >= (yes + no) * 2;
  return yes > no;
}

function transition(state, actor, action, ruleset) {
  const next = cloneState(state);
  switch (action.type) {
    case "RECOGNIZE":
      if (!next.present.includes(action.memberId)) throw new Error(`REFUSED:MEMBER_NOT_PRESENT:${action.memberId}`);
      next.recognizedMemberId = action.memberId;
      break;
    case "INTRODUCE_MOTION":
      next.motions[action.motionId] = { motionId: action.motionId, kind: action.kind, text: action.text, makerId: actor.actorId, parentMotionId: action.parentMotionId ?? null, secondedBy: null, status: "PENDING", votes: {} };
      next.pendingMotionIds.push(action.motionId);
      next.recognizedMemberId = null;
      break;
    case "SECOND_MOTION":
      next.motions[action.motionId].secondedBy = actor.actorId;
      next.motions[action.motionId].status = "SECONDED";
      break;
    case "OPEN_DEBATE":
      next.motions[action.motionId].status = "DEBATING";
      break;
    case "CLOSE_DEBATE":
      next.motions[action.motionId].status = "READY_FOR_VOTE";
      break;
    case "CALL_VOTE":
      next.motions[action.motionId].status = "VOTING";
      break;
    case "CAST_VOTE":
      next.motions[action.motionId].votes[action.memberId] = action.vote;
      break;
    case "ANNOUNCE_RESULT": {
      const motion = next.motions[action.motionId];
      motion.status = votePassed(ruleset.motionRule(motion.kind), motion.votes) ? "ADOPTED" : "REJECTED";
      next.pendingMotionIds = next.pendingMotionIds.filter(id => id !== action.motionId);
      break;
    }
    case "POINT_OF_ORDER": {
      const pointId = action.pointId ?? `${next.meetingId}:point:${Object.keys(next.pointsOfOrder).length + 1}`;
      next.pointsOfOrder[pointId] = { pointId, memberId: action.memberId ?? actor.actorId, againstActionId: action.againstActionId ?? null, reason: action.reason ?? "", status: "PENDING", ruling: null };
      break;
    }
    case "RULE_POINT_OF_ORDER":
      next.pointsOfOrder[action.pointId].status = "RULED";
      next.pointsOfOrder[action.pointId].ruling = action.ruling;
      break;
    case "APPEAL_RULING": {
      const appealId = action.appealId ?? `${next.meetingId}:appeal:${Object.keys(next.appeals).length + 1}`;
      next.appeals[appealId] = { appealId, pointId: action.pointId, actorId: actor.actorId, status: "PENDING" };
      break;
    }
    case "ADJOURN_MEETING":
      next.phase = "ADJOURNED";
      break;
    case "OBSERVE":
      break;
    default:
      throw new Error(`REFUSED:UNKNOWN_ACTION:${action.type}`);
  }
  next.actionCount += 1;
  return freezeState(next);
}

export class ParliamentaryEngine {
  constructor(ruleset, authority = new DenyDoAuthorityResolver()) {
    this.ruleset = assertRulesetProvider(ruleset);
    this.authority = authority;
    this.ledger = new ReceiptLedger();
  }

  apply(state, actor, action) {
    if (state.rulesetId !== this.ruleset.id) throw new Error("REFUSED:RULESET_IDENTITY_MISMATCH");
    const consequence = consequenceOf(action);
    let rejection = this.ruleset.validate(state, actor, action);
    if (!rejection) rejection = this.authority.authorize(state, actor, action, consequence);

    if (rejection) {
      const receipt = this.ledger.append({ meetingId: state.meetingId, rulesetId: state.rulesetId, actorId: actor.actorId, actorRole: actor.role, action: structuredClone(action), consequence, admitted: false, refusal: rejection, beforeDigest: digest(state), afterDigest: digest(state) });
      return Object.freeze({ admitted: false, state, refusal: rejection, receipt });
    }

    let next;
    try {
      next = transition(state, actor, action, this.ruleset);
    } catch (error) {
      const transitionRefusal = refusal("ACTION_REFUSED", String(error.message ?? error), "RRGYM-TRANSITION-001");
      const receipt = this.ledger.append({ meetingId: state.meetingId, rulesetId: state.rulesetId, actorId: actor.actorId, actorRole: actor.role, action: structuredClone(action), consequence, admitted: false, refusal: transitionRefusal, beforeDigest: digest(state), afterDigest: digest(state) });
      return Object.freeze({ admitted: false, state, refusal: transitionRefusal, receipt });
    }

    const receipt = this.ledger.append({ meetingId: state.meetingId, rulesetId: state.rulesetId, actorId: actor.actorId, actorRole: actor.role, action: structuredClone(action), consequence, admitted: true, refusal: null, beforeDigest: digest(state), afterDigest: digest(next) });
    return Object.freeze({ admitted: true, state: next, refusal: null, receipt });
  }
}

export const FrontierStatus = Object.freeze({ ALIVE: "ALIVE", DEFERRED: "DEFERRED", FALSIFIED: "FALSIFIED", REFUSED: "REFUSED" });

export class PossibilityFrontier {
  #items = new Map();

  add(candidate) {
    if (!candidate?.id) throw new TypeError("REFUSED:CANDIDATE_ID_REQUIRED");
    if (this.#items.has(candidate.id)) throw new Error(`REFUSED:DUPLICATE_CANDIDATE:${candidate.id}`);
    const item = Object.freeze({ ...structuredClone(candidate), status: FrontierStatus.ALIVE, history: [] });
    this.#items.set(candidate.id, item);
    return item;
  }

  get(id) {
    return this.#items.get(id);
  }

  #replace(id, status, evidence) {
    const current = this.#items.get(id);
    if (!current) throw new Error(`REFUSED:UNKNOWN_CANDIDATE:${id}`);
    if ([FrontierStatus.FALSIFIED, FrontierStatus.REFUSED].includes(current.status)) throw new Error(`REFUSED:TERMINAL_CANDIDATE:${id}`);
    const next = Object.freeze({ ...current, status, history: Object.freeze([...current.history, Object.freeze({ status, evidence: structuredClone(evidence) })]) });
    this.#items.set(id, next);
    return next;
  }

  defer(id, reason) {
    return this.#replace(id, FrontierStatus.DEFERRED, { reason });
  }

  revive(id, reason) {
    return this.#replace(id, FrontierStatus.ALIVE, { reason });
  }

  falsify(id, evidence) {
    if (!evidence?.receiptHash) throw new Error("REFUSED:FALSIFICATION_REQUIRES_RECEIPT");
    return this.#replace(id, FrontierStatus.FALSIFIED, evidence);
  }

  refuse(id, evidence = {}) {
    return this.#replace(id, FrontierStatus.REFUSED, evidence);
  }
}

function candidateScore(candidate) {
  const positive = candidate.evidence + candidate.expectedUtility + candidate.reversibility + candidate.novelty;
  const negative = candidate.uncertainty + candidate.cost;
  return Math.max(0, positive - negative);
}

export function allocateCMCA(candidates, budget) {
  if (!Number.isFinite(budget) || budget < 0) throw new TypeError("REFUSED:INVALID_CMCA_BUDGET");
  const admitted = candidates.filter(candidate => candidate.admitted);
  if (admitted.length === 0) return Object.freeze([]);
  const scored = admitted.map(candidate => ({ candidate, score: candidateScore(candidate) }));
  const total = scored.reduce((sum, item) => sum + item.score, 0);
  const denominator = total > 0 ? total : scored.length;
  return Object.freeze(scored.map(({ candidate, score }) => Object.freeze({ candidateId: candidate.id, mass: budget * (total > 0 ? score : 1) / denominator })));
}

export function buildLeague(planners, roles) {
  return Object.freeze(planners.flatMap(planner => roles.map(role => Object.freeze({ plannerId: planner.id, role, admitted: planner.compatibleRoles?.has(role) === true, planner }))));
}

export function receiptsToOcel(receipts) {
  const events = {};
  const objects = {};
  for (const receipt of receipts) {
    events[receipt.receiptId] = { "ocel:activity": receipt.action.type, "ocel:timestamp": `1970-01-01T00:00:${String(receipt.sequence).padStart(2, "0")}Z`, "ocel:omap": [receipt.meetingId], "ocel:vmap": { admitted: receipt.admitted, consequence: receipt.consequence, receiptHash: receipt.receiptHash } };
    objects[receipt.meetingId] = { "ocel:type": "rrgym:Meeting", "ocel:ovmap": { rulesetId: receipt.rulesetId } };
  }
  return Object.freeze({ "ocel:global-log": { "ocel:version": "2.0" }, events, objects });
}

export function replay({ initialState, receipts, ruleset, authority = new DenyDoAuthorityResolver() }) {
  const engine = new ParliamentaryEngine(ruleset, authority);
  let state = initialState;
  for (const expected of receipts) {
    const actor = { actorId: expected.actorId, role: expected.actorRole, authorityGrantIds: [] };
    const actual = engine.apply(state, actor, structuredClone(expected.action));
    if (actual.receipt.receiptHash !== expected.receiptHash || actual.admitted !== expected.admitted) return Object.freeze({ conformant: false, state, receipts: engine.ledger.all() });
    state = actual.state;
  }
  return Object.freeze({ conformant: engine.ledger.verify(), state, receipts: engine.ledger.all() });
}

const CAPABILITY_ACTIONS = Object.freeze(["RECOGNIZE", "INTRODUCE_MOTION", "SECOND_MOTION", "OPEN_DEBATE", "CLOSE_DEBATE", "CALL_VOTE", "CAST_VOTE", "ANNOUNCE_RESULT", "POINT_OF_ORDER", "RULE_POINT_OF_ORDER", "APPEAL_RULING", "ADJOURN_MEETING"]);

export class RRGymEnvironment {
  constructor({ episodeId, initialState, actor }, engine, verifier = new StatePostconditionVerifier()) {
    this.episodeId = episodeId;
    this.environmentId = `urn:rrgym:environment:${episodeId}`;
    this.actor = structuredClone(actor);
    this.engine = engine;
    this.verifier = verifier;
    this.state = initialState;
    this.rulesetId = initialState.rulesetId;
    this.meetingId = initialState.meetingId;
  }

  capabilities() {
    return Object.freeze(CAPABILITY_ACTIONS.map(type => Object.freeze({ id: `rrgym.${type.toLowerCase()}`, actionType: type, consequence: consequenceOf({ type }) })));
  }

  observe() {
    return Object.freeze({ episodeId: this.episodeId, environmentId: this.environmentId, state: structuredClone(this.state), receiptHead: this.engine.ledger.all().at(-1)?.receiptHash ?? null });
  }

  actuate(action, actor = this.actor) {
    const result = this.engine.apply(this.state, actor, action);
    if (result.admitted) this.state = result.state;
    return result;
  }

  verify(expected) {
    return this.verifier.verify(this.observe(), expected);
  }

  checkpoint() {
    return canonicalJson({ episodeId: this.episodeId, meetingId: this.meetingId, rulesetId: this.rulesetId, state: this.state });
  }

  restore(checkpoint) {
    const parsed = JSON.parse(checkpoint);
    if (parsed.episodeId !== this.episodeId || parsed.meetingId !== this.meetingId || parsed.rulesetId !== this.rulesetId || parsed.state?.meetingId !== this.meetingId || parsed.state?.rulesetId !== this.rulesetId) throw new Error("REFUSED:CHECKPOINT_IDENTITY_MISMATCH");
    this.state = Object.freeze(parsed.state);
    return this.observe();
  }

  teardown() {
    return Object.freeze({ episodeId: this.episodeId, receiptChainValid: this.engine.ledger.verify() });
  }
}

export class RRGymProvider {
  constructor({ ruleset = new PublicDomain1915Ruleset(), authority = new DenyDoAuthorityResolver(), verifier = new StatePostconditionVerifier() } = {}) {
    this.name = "rrgym";
    this.materializationRequiresAuthority = false;
    this.ruleset = assertRulesetProvider(ruleset);
    this.authority = authority;
    this.verifier = verifier;
  }

  materialize({ episodeId, initialState, actor }) {
    if (initialState.rulesetId !== this.ruleset.id) throw new Error("REFUSED:RULESET_IDENTITY_MISMATCH");
    const engine = new ParliamentaryEngine(this.ruleset, this.authority);
    return new RRGymEnvironment({ episodeId, initialState, actor }, engine, this.verifier);
  }
}
