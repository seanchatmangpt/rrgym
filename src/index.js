import { createHash } from "node:crypto";
// rrgym v26.8.12 constitutional kernel

// ---- canonical.js ----

export function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
}

export function digest(value) {
  return `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
}

// ---- receipt.js ----

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
    const unsigned = { schema: "urn:rrgym:receipt:v1", receiptId: `${input.meetingId}:${sequence}`, sequence, priorHash, ...input };
    const receipt = Object.freeze({ ...unsigned, receiptHash: digest(unsigned) });
    this.#receipts.push(receipt);
    return receipt;
  }

  all() { return Object.freeze([...this.#receipts]); }

  verify() { return verifyReceiptChain(this.#receipts); }
}

// ---- rules.js ----
const MOTION_RULES = Object.freeze({
  MAIN: { secondRequired: true, debatable: true, amendable: true, voteThreshold: "MAJORITY", precedence: 10 },
  AMEND: { secondRequired: true, debatable: true, amendable: true, voteThreshold: "MAJORITY", precedence: 30 },
  REFER: { secondRequired: true, debatable: true, amendable: true, voteThreshold: "MAJORITY", precedence: 40 },
  POSTPONE_DEFINITELY: { secondRequired: true, debatable: true, amendable: true, voteThreshold: "MAJORITY", precedence: 50 },
  PREVIOUS_QUESTION: { secondRequired: true, debatable: false, amendable: false, voteThreshold: "TWO_THIRDS", precedence: 80 },
  ADJOURN: { secondRequired: true, debatable: false, amendable: false, voteThreshold: "MAJORITY", precedence: 100 },
  RECONSIDER: { secondRequired: true, debatable: true, amendable: false, voteThreshold: "MAJORITY", precedence: 20 },
  RESCIND: { secondRequired: true, debatable: true, amendable: true, voteThreshold: "TWO_THIRDS", precedence: 20 }
});

const refusal = (code, message, ruleId) => ({ code, message, ruleId });
const pending = state => { const id = state.pendingMotionIds.at(-1); return id ? state.motions[id] : undefined; };

export function assertRulesetProvider(provider) {
  for (const key of ["id", "source", "authorityClass"]) if (typeof provider?.[key] !== "string") throw new TypeError(`REFUSED:RULESET_PROVIDER_MISSING:${key}`);
  for (const method of ["motionRule", "validate"]) if (typeof provider?.[method] !== "function") throw new TypeError(`REFUSED:RULESET_PROVIDER_MISSING:${method}`);
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
    const chairOnly = new Set(["RECOGNIZE", "OPEN_DEBATE", "CLOSE_DEBATE", "CALL_VOTE", "ANNOUNCE_RESULT", "RULE_POINT_OF_ORDER", "ADJOURN_MEETING"]);
    if (chairOnly.has(action.type) && actor.role !== "CHAIR") return refusal("ROLE_NOT_AUTHORIZED", `${action.type} requires CHAIR.`, "RRGYM-ROLE-001");

    if (action.type === "INTRODUCE_MOTION") {
      if (["OBSERVER", "PARLIAMENTARIAN"].includes(actor.role)) return refusal("ROLE_NOT_AUTHORIZED", "Role may not introduce motions.", "RRGYM-ROLE-002");
      if (state.recognizedMemberId !== actor.actorId) return refusal("RECOGNITION_REQUIRED", "Member must be recognized before introducing a motion.", "RRGYM-RECOGNITION-001");
      const current = pending(state);
      if (current && action.kind !== "AMEND" && this.motionRule(action.kind).precedence <= this.motionRule(current.kind).precedence) return refusal("MOTION_OUT_OF_ORDER", "Motion lacks precedence over pending question.", "RRGYM-PRECEDENCE-001");
      if (action.kind === "AMEND") {
        if (!action.parentMotionId || !state.motions[action.parentMotionId]) return refusal("MOTION_OUT_OF_ORDER", "Amendment requires an existing parent motion.", "RRGYM-AMEND-001");
        if (!this.motionRule(state.motions[action.parentMotionId].kind).amendable) return refusal("MOTION_OUT_OF_ORDER", "Parent motion is not amendable.", "RRGYM-AMEND-002");
      }
    }

    if (action.type === "RULE_POINT_OF_ORDER" || action.type === "APPEAL_RULING") {
      const point = state.pointsOfOrder?.[action.pointId];
      if (!point) return refusal("MOTION_NOT_FOUND", `Unknown point of order ${action.pointId}.`, "RRGYM-POINT-404");
      if (action.type === "APPEAL_RULING" && point.status === "PENDING") return refusal("RESULT_NOT_READY", "A pending point cannot be appealed before the chair rules.", "RRGYM-APPEAL-001");
    }

    if (action.motionId && action.type !== "INTRODUCE_MOTION") {
      const motion = state.motions[action.motionId];
      if (!motion) return refusal("MOTION_NOT_FOUND", `Unknown motion ${action.motionId}.`, "RRGYM-MOTION-404");
      const rule = this.motionRule(motion.kind);
      if (action.type === "SECOND_MOTION" && !rule.secondRequired) return refusal("MOTION_NOT_SECONDABLE", "Motion does not require a second.", "RRGYM-SECOND-002");
      if (action.type === "SECOND_MOTION" && actor.actorId === motion.makerId) return refusal("MOTION_NOT_SECONDABLE", "Maker may not second own motion in this seed model.", "RRGYM-SECOND-003");
      if (action.type === "OPEN_DEBATE") {
        if (!rule.debatable) return refusal("DEBATE_NOT_ALLOWED", `${motion.kind} is not debatable.`, "RRGYM-DEBATE-001");
        if (rule.secondRequired && !motion.secondedBy) return refusal("SECOND_REQUIRED", "Second required before debate.", "RRGYM-SECOND-001");
        if (motion.status === "DEBATING") return refusal("DEBATE_ALREADY_OPEN", "Debate is already open.", "RRGYM-DEBATE-002");
      }
      if (action.type === "CLOSE_DEBATE" && motion.status !== "DEBATING") return refusal("DEBATE_NOT_OPEN", "Debate is not open.", "RRGYM-DEBATE-003");
      if (action.type === "CALL_VOTE" && rule.secondRequired && !motion.secondedBy) return refusal("SECOND_REQUIRED", "Second required before vote.", "RRGYM-SECOND-001");
      if (action.type === "CAST_VOTE") {
        if (motion.status !== "VOTING") return refusal("VOTE_NOT_OPEN", "Vote is not open.", "RRGYM-VOTE-001");
        if (!state.present.includes(action.memberId)) return refusal("ROLE_NOT_AUTHORIZED", "Only present members may vote.", "RRGYM-VOTE-003");
        if (actor.actorId !== action.memberId) return refusal("ROLE_NOT_AUTHORIZED", "An actor may only cast its own vote in the core ruleset.", "RRGYM-VOTE-004");
        if (motion.votes[action.memberId]) return refusal("DUPLICATE_VOTE", "Member already voted.", "RRGYM-VOTE-002");
      }
      if (action.type === "ANNOUNCE_RESULT") {
        if (motion.status !== "VOTING") return refusal("RESULT_NOT_READY", "Motion is not in voting state.", "RRGYM-RESULT-001");
        if (Object.keys(motion.votes).length < state.present.length) return refusal("RESULT_NOT_READY", "All present members must have a recorded vote or abstention in this seed model.", "RRGYM-RESULTE-002");
      }
    }
    return null;
  }
}

// ---- authority.js ----
export class DenyDoAuthorityResolver {
  authorize(_state, _actor, _action, consequence) {
    return consequence === "DO" ? { code: "AUTHORITY_REQUIRED", message: "DO requires explicit authority.", ruleId: "RRGYM-BRCE-001" } : null;
  }
}

export class AllowListAuthorityResolver {
  constructor(grants = []) { this.grants = new Set(grants); }
  add(grant) { this.grants.add(grant); }
  authorize(state, actor, action, consequence) {
    if (consequence !== "DO") return null;
    const grant = `${state.meetingId}:${actor.actorId}:${action.type}`;
    return this.grants.has(grant) ? null : { code: "AUTHORITY_REQUIRED", message: `Missing explicit grant ${grant}.`, ruleId: "RRGYM-BRCE-001" };
  }
}

// ---- verification.js ----
export class StatePostconditionVerifier {
  verify(observation, expected) {
    const state = observation.state;
    const failures = [];
    if (expected.phase !== undefined && state.phase !== expected.phase) failures.push(`phase:${state.phase}!=${expected.phase}`);
    if (expected.pendingMotionIds !== undefined && JSON.stringify(state.pendingMotionIds) !== JSON.stringify(expected.pendingMotionIds)) failures.push("pendingMotionIds:mismatch");
    if (expected.motionStatus) {
      for (const [id, status] of Object.entries(expected.motionStatus)) if (state.motions[id]?.status !== status) failures.push(`motion:${id}:${state.motions[id]?.status ?? "MISSING"}!=${status}`);
    }
    return Object.freeze({ passed: failures.length === 0, failures: Object.freeze(failures) });
  }
}

// ---- engine.js ----

export function createMeeting({ meetingId, rulesetId, members, present = members, quorum = Math.floor(members.length / 2) + 1 }) {
  return Object.freeze({ meetingId, rulesetId, phase: "OPEN", members: [...members], present: [...present], quorum, motions: {}, pendingMotionIds: [], pointsOfOrder: {}, appeals: {}, actionCount: 0 });
}

const consequenceOf = action => ["CAST_VOTE", "ANNOUNCE_RESULTH‹Q“ÕT“—ÓQQUS‘È—Kš[˜ÛY\ÊXÝ[Û‹\JHÈ‘ÈˆˆÓÓ”Õ•PÕŽÂ˜ÛÛœÝÛÛ™TÝ]HHÝ]HOˆÝXÝ\™YÛÛ™JÝ]JNÂ‚™[˜Ý[Ûˆ›ÝT\ÜÙY
[Ý[Û‹™\ÚÛ
HÂˆÛÛœÝ›Ý\ÈHØš™XÝ˜[Y\Ê[Ý[Û‹›Ý\ÊK™š[\ŠˆOˆˆOOHP”ÕRSˆŠNÂˆÛÛœÝY\ÈH›Ý\Ë™š[\ŠˆOˆˆOOH–QTÈŠK›[™ÝÂˆÛÛœÝ›ÈH›Ý\Ë™š[\ŠˆOˆˆOOH““ÈŠK›[™ÝÂˆYˆ
›Ý\Ë›[™ÝOOH
H™]\›ˆ˜[ÙNÂˆ™]\›ˆ™\ÚÛOOH“PR“Ô’UHˆÈY\Èˆ›ÈˆY\È
ˆÈH›Ý\Ë›[™Ý
ˆŽÂŸB‚™^ÜÛ\ÜÈ\›X[Y[\žQ[™Ú[™HÂˆÛÛœÝXÝÜŠ[\Ù]]]Üš]HH™]È[žQÐ]]Üš]T™\ÛÛ™\Š
JHÈ\Ëœ[\Ù]H\ÜÙ\[\Ù]›ÝšY\Š[\Ù]
NÈ\Ë˜]]Üš]HH]]Üš]NÈ\Ë›YÙ\ˆH™]È™XÙZ\YÙ\Š
NÈB‚ˆ\JÝ]KXÝÜ‹XÝ[ÛŠHÂˆÛÛœÝXÝ[Û’YH	ÜÝ]K›YY][™ÒYN˜N‰ÜÝ]K˜XÝ[ÛÛÝ[
È_XÂˆÛÛœÝÛÛœÙ\]Y[˜ÙHHÛÛœÙ\]Y[˜ÙSÙŠXÝ[ÛŠNÂˆÛÛœÝ™Y\Ø[H\Ëœ[\Ù]˜[Y]JÝ]KXÝÜ‹XÝ[ÛŠHÏÈ\Ë˜]]Üš]K˜]]Üš^™JÝ]KXÝÜ‹XÝ[Û‹ÛÛœÙ\]Y[˜ÙJNÂˆYˆ
™Y\Ø[
H™]\›ˆ\ËˆÙš[š\Ú
Ý]KXÝÜ‹XÝ[Û‹XÝ[Û’YÛÛœÙ\]Y[˜ÙK˜[ÙK™Y\Ø[
NÂ‚ˆÛÛœÝ™^HÛÛ™TÝ]JÝ]JNÂˆ™^˜XÝ[ÛÛÝ[
ÏHNÂˆ™^›\ÝXÝ[Û’YHXÝ[Û’YÂˆÝÚ]Ú
XÝ[Û‹\JHÂˆØ\ÙH”‘PÓÑÓ’V‘HŽˆ™^œ™XÛÙÛš^™YY[X™\’YHXÝ[Û‹›Y[X™\’YÈœ™XZÎÂˆØ\ÙH’S•“ÑPÑWÓSÕSÓˆŽ‚ˆ™^›[Ý[ÛœÖØXÝ[Û‹›[Ý[Û’YHHÈYˆXÝ[Û‹›[Ý[Û’YÚ[™ˆXÝ[Û‹šÚ[™^ˆXÝ[Û‹^XZÙ\’YˆXÝÜ‹˜XÝÜ’Y‹‹ŠXÝ[Û‹œ\™[[Ý[Û’YÈÈ\™[[Ý[Û’YˆXÝ[Û‹œ\™[[Ý[Û’YHˆßJKÝ]\Îˆ”“ÔÔÑQ‹›Ý\ÎˆßHNÂˆ™^œ[™[™Ó[Ý[Û’YËœ\Ú
XÝ[Û‹›[Ý[Û’Y
NÈ™^œ™XÛÙÛš^™YY[X™\’YH[™Yš[™YÈœ™XZÎÂˆØ\ÙH”ÑPÓÓ‘ÓSÕSÓˆŽˆ™^›[Ý[ÛœÖØXÝ[Û‹›[Ý[Û’YKœÙXÛÛ™YžHHXÝÜ‹˜XÝÜ’YÈ™^›[Ý[ÛœÖØXÝ[Û‹›[Ý[Û’YKœÝ]\ÈH”S‘S‘ÈŽÈœ™XZÎÂˆØ\ÙH“ÔS—ÑPUHŽˆ™^›[Ý[ÛœÖØXÝ[Û‹›[Ý[Û’YKœÝ]\ÈH‘PUS‘ÈŽÈœ™XZÎÂˆØ\ÙHÓÔÑWÑPUHŽˆ™^›[Ý[ÛœÖØXÝ[Û‹›[Ý[Û’YKœÝ]\ÈH”S‘S‘ÈŽÈœ™XZÎÂˆØ\ÙHÐSÕ“ÕHŽˆ™^›[Ý[ÛœÖØXÝ[Û‹›[Ý[Û’YKœÝ]\ÈH•“ÕS‘ÈŽÈœ™XZÎÂˆØ\ÙHÐTÕÕ“ÕHŽˆ™^›[Ý[ÛœÖØXÝ[Û‹›[Ý[Û’YK›Ý\ÖØXÝ[Û‹›Y[X™\’YHHXÝ[Û‹›ÝNÈœ™XZÎÂˆØ\ÙHS““ÕSÑWÔ‘TÕSŽˆÈÛÛœÝHH™^›[Ý[ÛœÖØXÝ[Û‹›[Ý[Û’YNÈKœÝ]\ÈH›ÝT\ÜÙY
K\Ëœ[\Ù]›[Ý[Û”[JKšÚ[™
K›ÝU™\ÚÛ
HÈQÔQˆˆ”‘R‘PÕQŽÈ™^œ[™[™Ó[Ý[Û’YÈH™^œ[™[™Ó[Ý[Û’YË™š[\ŠYOˆYOOHKšY
NÈœ™XZÎÈBˆØ\ÙHQ“ÕT“—ÓQQUS‘ÈŽˆ™^œ\ÙHHQ“ÕT“‘QŽÈœ™XZÎÂˆØ\ÙH”ÒS•ÓÑ—ÓÔ‘TˆŽˆÂˆÛÛœÝÚ[YH	ØXÝ[Û’YNœÚ[Âˆ™^œÚ[ÓÙ“Ü™\–ÜÚ[YHHÈYˆÚ[Y˜Z\ÙYžNˆXÝÜ‹˜XÝÜ’YYØZ[œÝXÝ[Û’YˆXÝ[Û‹˜YØZ[œÝXÝ[Û’Y™X\ÛÛŽˆXÝ[Û‹œ™X\ÛÛ‹Ý]\Îˆ”S‘S‘ÈˆNÂˆœ™XZÎÂˆBˆØ\ÙH”•SWÔÒS•ÓÑ—ÓÔ‘TˆŽˆÂˆÛÛœÝÚ[H™^œÚ[ÓÙ“Ü™\–ØXÝ[Û‹œÚ[YNÂˆYˆ
\Ú[
H›ÝÈ™]È\œ›ÜŠ‘Q•TÑQ”ÒS•Ó“ÕÑ“ÕS‘‰ØXÝ[Û‹œÚ[YX
NÂˆÚ[œÝ]\ÈHXÝ[Û‹œ[[™ÎÈÚ[œ[YžHHXÝÜ‹˜XÝÜ’YÂˆœ™XZÎÂˆBˆØ\ÙHTPSÔ•SS‘ÈŽˆÂˆÛÛœÝÚ[H™^œÚ[ÓÙ“Ü™\–ØXÝ[Û‹œÚ[YNÂˆYˆ
\Ú[Ú[œÝ]\ÈOOH”S‘S‘ÈŠH›ÝÈ™]È\œ›ÜŠ‘Q•TÑQ”ÒS•Ó“ÕÔ’TWÑ“Ô—ÐTPS‰ØXÝ[Û‹œÚ[YX
NÂˆÛÛœÝ\X[YH	ØXÝ[Û’YN˜\X[Âˆ™^˜\X[ÖØ\X[YHHÈYˆ\X[YÚ[YˆXÝ[Û‹œÚ[Y\X[YžNˆXÝÜ‹˜XÝÜ’YÝ]\Îˆ”S‘S‘ÈˆNÂˆœ™XZÎÂˆBˆY˜][ˆ›ÝÈ™]È\œ›ÜŠ‘Q•TÑQ•S’Ó“ÕÓ—ÐPÕSÓŽ‰ØXÝ[Û‹\_X
NÂˆBˆ™]\›ˆ\ËˆÙš[š\Ú
Øš™XÝ™œ™Y^™J™^
KXÝÜ‹XÝ[Û‹XÝ[Û’YÛÛœÙ\]Y[˜ÙKYJNÂˆB‚ˆÙš[š\Ú
Ý]KXÝÜ‹XÝ[Û‹XÝ[Û’YÛÛœÙ\]Y[˜ÙKYZ]Y™Y\Ø[
HÂˆÛÛœÝ™XÙZ\H\Ë›YÙ\‹˜\[™
ÈYY][™ÒYˆÝ]K›YY][™ÒYXÝ[Û’YXÝÜ’YˆXÝÜ‹˜XÝÜ’Y›ÛNˆXÝÜ‹œ›ÛKÛÛœÙ\]Y[˜ÙKYZ]YXÝ[Û‹‹‹Š™Y\Ø[ÈÈ™Y\Ø[HˆßJKÝ]R\Úˆ™XÙZ\YÙ\”Ý]Kš\Ú
Ý]JHJNÂˆ™]\›ˆØš™XÝ™œ™Y^™JÈYZ]YÝ]KXÝ[Û’YÛÛœÙ\]Y[˜ÙK‹‹Š™Y\Ø[ÈÈ™Y\Ø[HˆßJK™XÙZ\JNÂˆBŸB‚˜ÛÛœÝ™XÙZ\YÙ\”Ý]HHÈ\ÚˆYÙ\ÝNÂ‚‹ËÈKKKH[›™\‹šœÈKKKB™^Ü[˜Ý[ÛˆYZ][›™\Š[›™\‹›ÛJHÂˆ™]\›ˆ[›™\‹˜ÛÛ\]X›T›Û\Ëš\Ê›ÛJBˆÈØš™XÝ™œ™Y^™JÈ[›™\’Yˆ[›™\‹šY›ÛKYZ]YˆYHJBˆˆØš™XÝ™œ™Y^™JÈ[›™\’Yˆ[›™\‹šY›ÛKYZ]Yˆ˜[ÙK™X\ÛÛŽˆ‘Q•TÑQ”S“‘T—Ô“ÓWÒSÓÓTUP“N‰Ü[›™\‹šYN‰Ü›Û_XJNÂŸB‚™^Ü[˜Ý[Ûˆ^[Ù™”™XÛÜ™
È\\ÛÙRY[›™\’Y›ÛK][]HH[Uš[Û][ÛœÈHXÚ\Ú[ÛœÔ™XXÚYH™YÜ™]HJHÂˆ™]\›ˆØš™XÝ™œ™Y^™JÈ\\ÛÙRY[›™\’Y›ÛK][]K[Uš[Û][ÛœËXÚ\Ú[ÛœÔ™XXÚY™YÜ™]JNÂŸB‚‹ËÈKKKHœ›ÛY\‹šœÈKKKB™^ÜÛÛœÝœ›ÛY\”Ý]\ÈHØš™XÝ™œ™Y^™JÈSU‘NˆSU‘H‹Q‘T”‘Qˆ‘Q‘T”‘Q‹SÒQ’QQˆ‘SÒQ’QQ‹‘Q•TÑQˆ”‘Q•TÑQ‹‘UT‘Qˆ”‘UT‘QˆJNÂ‚™^ÜÛ\ÜÈÜÜÚXš[]Qœ›ÛY\ˆÂˆÚ][\ÈH™]ÈX\

NÂˆY
Ø[™Y]JHÂˆYˆ
XØ[™Y]OËšY
H›ÝÈ™]È\Q\œ›ÜŠ˜Ø[™Y]KšY™\]Z\™YŠNÂˆYˆ
\ËˆÚ][\Ëš\ÊØ[™Y]KšY
JH›ÝÈ™]È\œ›ÜŠ‘Q•TÑQ‘TPÐUWÐÐS‘QUN‰ØØ[™Y]KšYX
NÂˆ\ËˆÚ][\ËœÙ]
Ø[™Y]KšYØš™XÝ™œ™Y^™JÈ‹‹˜Ø[™Y]KÝ]\Îˆœ›ÛY\”Ý]\ËSU‘K]šY[˜ÙNˆ×HJJNÂˆ™]\›ˆ\Ë™Ù]
Ø[™Y]KšY
NÂˆBˆÙ]
Y
HÈ™]\›ˆ\ËˆÚ][\Ë™Ù]
Y
NÈBˆ[

HÈ™]\›ˆØš™XÝ™œ™Y^™JË‹‹\ËˆÚ][\Ë˜[Y\Ê
WJNÈBˆY™\ŠY™X\ÛÛŠHÈ™]\›ˆ\ËˆÝ˜[œÚ][ÛŠYœ›ÛY\”Ý]\Ë‘Q‘T”‘Q™X\ÛÛ‹˜[ÙJNÈBˆ™]š]™JY™X\ÛÛŠHÈ™]\›ˆ\ËˆÝ˜[œÚ][ÛŠYœ›ÛY\”Ý]\ËSU‘K™X\ÛÛ‹˜[ÙJNÈBˆ˜[ÚYžJY]šY[˜ÙJHÈYˆ
Y]šY[˜ÙOËœ™XÙZ\\Ú
H›ÝÈ™]È\œ›ÜŠ”‘Q•TÑQ‘SÒQ’PÐUSÓ—Ô‘TURT‘T×Ô‘PÑRTŠNÈ™]\›ˆ\ËˆÝ˜[œÚ][ÛŠYœ›ÛY\”Ý]\Ë‘SÒQ’QQ]šY[˜ÙKYJNÈBˆ™Y\ÙJY]šY[˜ÙJHÈYˆ
Y]šY[˜ÙOËœ[RY
H›ÝÈ™]È\œ›ÜŠ”‘Q•TÑQ”‘Q•TÐSÔ‘TURT‘T×Ô•SHŠNÈ™]\›ˆ\ËˆÝ˜[œÚ][ÛŠYœ›ÛY\”Ý]\Ë”‘Q•TÑQ]šY[˜ÙKYJNÈBˆÝ˜[œÚ][ÛŠYÝ]\Ë]šY[˜ÙK\›Z[˜[
HÂˆÛÛœÝÝ\œ™[]\ËˆÚ][\Ë™Ù]
Y
NÈYˆ
XÝ\œ™[
H›ÝÈ™]È\œ›ÜŠ‘Q•TÑQÐS‘QUWÓ“ÕÑ“ÕS‘‰ÚYX
NÂˆYˆ
Ñœ›ÛY\”Ý]\Ë‘SÒQ’QQœ›ÛY\”Ý]\Ë”‘Q•TÑQœ›ÛY\”Ý]\Ë”‘UT‘QKš[˜ÛY\ÊÝ\œ™[œÝ]\ÊJH›ÝÈ™]È\œ›ÜŠ‘Q•TÑQ•T“RSSÐÐS‘QUN‰ÚYN‰ØÝ\œ™[œÝ]\ßX
NÂˆÛÛœÝ™^SØš™XÝ™œ™Y^™JÈ‹‹˜Ý\œ™[Ý]\Ë\›Z[˜[]šY[˜ÙN“Øš™XÝ™œ™Y^™JË‹‹˜Ý\œ™[™]šY[˜ÙK]šY[˜ÙWJHJNÈ\ËˆÚ][\ËœÙ]
Y™^
NÈ™]\›ˆ™^ÂˆBŸB‚‹ËÈKKKHÛXØKšœÈKKKB™^Ü[˜Ý[Ûˆ[ØØ]PÓPÐJØ[™Y]\ËYÙ]
HÂˆYˆ
S[X™\‹š\Ñš[š]JYÙ]
HYÙ]
H›ÝÈ™]È˜[™ÙQ\œ›ÜŠ˜YÙ]]\Ý™Hš[š]H[™›Û‹[™YØ]]™HŠNÂˆÛÛœÝ]Ù[HØ[™Y]\Ë™š[\ŠÈOˆË˜YZ]Y
NÂˆYˆ
]Ù[›[™ÝOOH
H™]\›ˆØš™XÝ™œ™Y^™J×JNÂˆÛÛœÝØÛÜ™\ÈH]Ù[›X\
ÈOˆX]›X^

Ë™^XÝY][]H
ÈË[˜Ù\Z[H
ÈË››Ý™[H
ÈËœ™]™\œÚXš[]H
ÈË™]šY[˜ÙJHÈX]›X^
Ë˜ÛÜÝYKNJJJNÂˆÛÛœÝÝ[HØÛÜ™\Ëœ™YXÙJ
KŠHOˆH
È‹
NÂˆ™]\›ˆØš™XÝ™œ™Y^™J]Ù[›X\

ËJHOˆØš™XÝ™œ™Y^™JÈØ[™Y]RYˆËšYX\ÜÎˆÝ[OOHÈYÙ]È]Ù[›[™ÝˆYÙ]
ˆØÛÜ™\ÖÚWHÈÝ[Y™\œ™YˆÝ[OOH	‰ˆØÛÜ™\ÖÚWHOOHJJJNÂŸB‚‹ËÈKKKHY]šXÜËšœÈKKKB™^Ü[˜Ý[ÛˆYX\Ý\™QÛÝ™\›˜[˜ÙJÝ]JHÂˆÛÛœÝ[Ý[ÛœÈHØš™XÝ˜[Y\ÊÝ]K›[Ý[ÛœÊNÂˆÛÛœÝ\ÜÜÙYH[Ý[ÛœË™š[\ŠHOˆÈQÔQ‹”‘R‘PÕQ—Kš[˜ÛY\ÊKœÝ]\ÊJK›[™ÝÂˆÛÛœÝ›Ý\œÈH™]ÈÙ]
[Ý[ÛœË™›]X\
HOˆØš™XÝšÙ^\ÊK›Ý\ÊJJNÂˆÛÛœÝ›Ý\ÈH[Ý[ÛœË™›]X\
HOˆØš™XÝ˜[Y\ÊK›Ý\ÊJK™š[\ŠˆOˆˆOOHP”ÕRSˆŠNÂˆÛÛœÝ›ÈH›Ý\Ë™š[\ŠˆOˆˆOOH““ÈŠK›[™ÝÂˆ™]\›ˆØš™XÝ™œ™Y^™JÂˆ\ÜÜÚ][Û”˜]Nˆ[Ý[ÛœË›[™ÝÈ\ÜÜÙYÈ[Ý[ÛœË›[™Ýˆˆ\XÚ\][Û”˜]NˆÝ]Kœ™\Ù[›[™ÝÈ›Ý\œËœÚ^™HÈÝ]Kœ™\Ù[›[™ÝˆˆZ[›Üš]T›ÝXÝ[Û”›ÞNˆ›Ý\Ë›[™ÝÈ›ÈÈ›Ý\Ë›[™ÝˆKˆ›ØÙY\˜[Y™šXÚY[˜ÞNˆÝ]K˜XÝ[ÛÛÝ[È\ÜÜÙYÈÝ]K˜XÝ[ÛÛÝ[ˆˆ[œ™\ÛÛ™YÜÜÚXš[]NˆÝ]Kœ[™[™Ó[Ý[Û’YË›[™ÝˆJNÂŸB‚‹ËÈKKKHØÙ[šœÈKKKB™^Ü[˜Ý[Ûˆ™XÙZ\ÕÓØÙ[
™XÙZ\ËÈÙÒYH\›Žœœ™Þ[N›ØÙ[ŒHˆHHßJHÂˆÛÛœÝ]™[ÈHßNÈÛÛœÝØš™XÝÈHßNÂˆ›Üˆ
ÛÛœÝˆÙˆ™XÙZ\ÊHÂˆÛÛœÝYY][™ÓØš™XÝHYY][™Î‰Ü‹›YY][™ÒYXÈÛÛœÝXÝÜ“Øš™XÝHXÝÜŽ‰Ü‹˜XÝÜ’YXÂˆØš™XÝÖÛYY][™ÓØš™XÝHÏÏHÈ\Nˆ›YY][™È‹]šX]\ÎˆÞÈ˜[YNˆ›YY][™ÒY‹˜[YNˆ‹›YY][™ÒYWHNÂˆØš™XÝÖØXÝÜ“Øš™XÝHÏÏHÈ\Nˆ˜XÝÜˆ‹]šX]\ÎˆÞÈ˜[YNˆœ›ÛH‹˜[YNˆ‹œ›ÛHWHNÂˆ]™[ÖÜ‹œ™XÙZ\YHHÂˆ\Nˆ‹˜YZ]YÈ˜YZ]Y]˜[œÚ][Ûˆˆˆœ™Y\ÙY]˜[œÚ][Ûˆ‹ˆ[YNˆ™]È]J
KÒTÓÔÝš[™Ê
Kˆ]šX]\ÎˆÂˆÈ˜[YNˆ˜XÝ[Û’Y‹˜[YNˆ‹˜XÝ[Û’YKˆÈ˜[YNˆ˜XÝ[Û•\H‹˜[YNˆ‹˜XÝ[Û‹\HKˆÈ˜[YNˆ˜ÛÛœÙ\]Y[˜ÙH‹˜[YNˆ‹˜ÛÛœÙ\]Y[˜ÙHKˆÈ˜[YNˆœ™XÙZ\\Ú‹˜[YNˆ‹œ™XÙZ\\ÚKˆ‹‹Š‹œ™Y\Ø[ÈÞÈ˜[YNˆœ™Y\Ø[ÛÙH‹˜[YNˆ‹œ™Y\Ø[˜ÛÙHWHˆ×JBˆKˆ™[][ÛœÚ\ÎˆÞÈØš™XÝYˆYY][™ÓØš™XÝ]X[YšY\Žˆ›YY][™ÈˆKÈØš™XÝYˆXÝÜ“Øš™XÝ]X[YšY\Žˆ˜XÝÜˆˆWBˆNÂˆBˆ™]\›ˆØš™XÝ™œ™Y^™JÈØÙ[™\œÚ[ÛŽˆŒ‹Œ‹ÙÒY]™[\\ÎˆÈ˜YZ]Y]˜[œÚ][Ûˆ‹œ™Y\ÙY]˜[œÚ][Ûˆ—KØš™XÝ\\ÎˆÈ›YY][™È‹˜XÝÜˆ—K]™[ËØš™XÝÈJNÂŸB‚‹ËÈKKKH™YX[KšœÈKKKB™^ÜÛÛœÝ“ÐÑQTSÐUPÒÔÈHØš™XÝ™œ™Y^™JÂˆÈYˆ˜YÙ[™KXØ\\™H‹Øš™XÝ]™NˆÛÛ›ÛÚXÚ]Y\Ý[ÛœÈ™XXÚ\ÜÜÚ][Ûˆ‹ØœÙ\˜X›Nˆ™\ÜÜÚ][ÛˆÚÙ]È[™\ˆY[XØ[™Y™\™[˜Ù\ÈˆKˆÈYˆ˜[Y[™Y[Y›ÛÙ‹Øš™XÝ]™NˆÛÛœÝ[YH[X™\˜][ÛˆYÙ]Ú]]Ù[[Y[™Y[È‹ØœÙ\˜X›Nˆ˜XÝ[ÛœÈ\ˆ\ÜÜÙY[Ý[ÛˆˆKˆÈYˆœ][Ü[K\™\ÜÝ\™H‹Øš™XÝ]™Nˆ”™]™[Üˆ[^H]Ù[\ÜÜÚ][ÛˆžH][Ü[HÝ]H‹ØœÙ\˜X›Nˆ˜›ØÚÙY\\ÛÙ\ÈˆKˆÈYˆœ™[X]\™KXÛÜÝ\™H‹Øš™XÝ]™Nˆ•\›Z[˜]HX˜]H™Y›Ü™H[™›Ü›X][Ûˆ\È[˜ÛÜœÜ˜]Y‹ØœÙ\˜X›Nˆœ™YÜ™]Y\ˆY[ˆ]šY[˜ÙH™]™X[ˆKˆÈYˆ›Z[›Üš]K\Ý\™\ÜÚ[Ûˆ‹Øš™XÝ]™Nˆ”™YXÙHY™™XÝ]™H\XÚ\][ÛˆÙˆHZ[›Üš]HÛØ[][Ûˆ‹ØœÙ\˜X›Nˆœ\XÚ\][Û‹Ù˜Z\›™\ÜÈ]™\™Ù[˜ÙHˆKˆÈYˆœ›ØÙY\˜[YXYØÚÈ‹Øš™XÝ]™Nˆ“XZ[Z[ˆHYØ[]›Û‹]\›Z[˜][™È[Ý[ÛˆÜÛÙÞH‹ØœÙ\˜X›Nˆ˜›Ý[™YZÜš^›Ûˆ›ËY\ÜÜÚ][ÛˆˆB—JNÂ‚™^Ü[˜Ý[Ûˆ]XÚÐØ][ÙÊ
HÈ™]\›ˆ“ÐÑQTSÐUPÒÔË›X\
Oˆ
È‹‹žJJNÈB‚‹ËÈKKKHØÙ[˜\š[ËšœÈKKKB™^Ü[˜Ý[ÛˆÜ™X]TØÙ[˜\š[Ê[œ]
HÂˆYˆ
Z[œ]ËœØÙ[˜\š[ÒYZ[œ]Ë›YY][™ÒYP\œ˜^Kš\Ð\œ˜^J[œ]›Y[X™\œÊJH›ÝÈ™]È\Q\œ›ÜŠœØÙ[˜\š[ÒYYY][™ÒYY[X™\œÈ™\]Z\™YŠNÂˆYˆ
™]ÈÙ]
[œ]›Y[X™\œÊKœÚ^™HOOH[œ]›Y[X™\œË›[™Ý
H›ÝÈ™]È\œ›ÜŠ”‘Q•TÑQ‘TPÐUWÓQSP‘TˆŠNÂˆ™]\›ˆØš™XÝ™œ™Y^™JÂˆØÙ[˜\š[ÒYˆ[œ]œØÙ[˜\š[ÒYˆØš™XÝ]™Nˆ[œ]›Øš™XÝ]™HÏÈœ™XXÚ]Ù[\ÜÜÚ][Ûˆ‹ˆ[™›Ü›X][Û”\][ÛœÎˆØš™XÝ™œ™Y^™J[œ]š[™›Ü›X][Û”\][ÛœÈÏÈßJKˆÛÜ›ˆÜ™X]SYY][™ÊÈYY][™ÒYˆ[œ]›YY][™ÒY[\Ù]Yˆ[œ]œ[\Ù]YY[X™\œÎˆ[œ]›Y[X™\œË™\Ù[ˆ[œ]œ™\Ù[ÏÈ[œ]›Y[X™\œË][Ü[Nˆ[œ]œ][Ü[HJBˆJNÂŸB‚‹ËÈKKKHXYÝYKšœÈKKKB™^Ü[˜Ý[ÛˆZ[XYÝYJ[›™\œË›Û\ÊHÂˆ™]\›ˆØš™XÝ™œ™Y^™J[›™\œË™›]X\
[›™\ˆOˆ›Û\Ë›X\
›ÛHOˆYZ][›™\Š[›™\‹›ÛJJJJNÂŸB‚™^Ü[˜Ý[Ûˆ[”ÛXÞQ\\ÛÙJÈ[›™\‹›ÛKXÝÜ’Y[š\›Û›Y[X^Ý\ÈHLJHÂˆÛÛœÝYZ\ÜÚ[ÛˆHYZ][›™\Š[›™\‹›ÛJNÈYˆ
XYZ\ÜÚ[Û‹˜YZ]Y
H™]\›ˆØš™XÝ™œ™Y^™JÈÝ[™[™Îˆ”‘Q•TÑQ‹YZ\ÜÚ[Û‹Ý\Îˆ™XÙZ\Îˆ×HJNÂˆÛÛœÝXÝÜˆHÈXÝÜ’Y›ÛK]]Üš]QÜ˜[YÎˆ×HNÂˆYˆ
[š\›Û›Y[˜ÛÛ™šYË˜XÝÜ‹˜XÝÜ’YOOHXÝÜ’Y[š\›Û›Y[˜ÛÛ™šYË˜XÝÜ‹œ›ÛHOOH›ÛJH›ÝÈ™]È\œ›ÜŠ”‘Q•TÑQ‘TTÓÑWÐPÕÔ—ÓRTÓPUÒŠNÂˆ]Ý\ÈHÂˆÚ[H
Ý\ÈX^Ý\ÊHÂˆÛÛœÝØœÈH[š\›Û›Y[›ØœÙ\™J
NÈÛÛœÝ›ÜÜØ[ÈH[›™\‹œ›ÜÜÙJØœËœÝ]KXÝÜŠNÈYˆ
\›ÜÜØ[ÏË›[™Ý
Hœ™XZÎÂˆÛÛœÝ™\Ý[H[š\›Û›Y[˜XÝ
›ÜÜØ[ÖÌJNÈÝ\È
ÏHNÂˆYˆ
\™\Ý[˜YZ]Y	‰ˆ[›™\‹œÝÜÛ”™Y\Ø[OOH˜[ÙJHœ™XZÎÂˆYˆ
[š\›Û›Y[›ØœÙ\™J
KœÝ]Kœ\ÙHOOHQ“ÕT“‘QŠHœ™XZÎÂˆBˆ™]\›ˆØš™XÝ™œ™Y^™JÈÝ[™[™ÎˆÝ\ÈX^Ý\ÈÈSU‘Hˆˆ“ÐÒÑQ‹Ý\Ë™XÙZ\Îˆ[š\›Û›Y[™[™Ú[™K›YÙ\‹˜[

HJNÂŸB‚‹ËÈKKKH™\^KšœÈKKKB™^Ü[˜Ý[Ûˆ™\^JÈ[š]X[Ý]K™XÙZ\Ë[\Ù]]]Üš]HJHÂˆÛÛœÝ[™Ú[™HH™]È\›X[Y[\žQ[™Ú[™J[\Ù]]]Üš]JNÈ]Ý]HH[š]X[Ý]NÂˆ›Üˆ
ÛÛœÝ^XÝYÙˆ™XÙZ\ÊHÂˆÛÛœÝXÝÜˆHÈXÝÜ’Yˆ^XÝY˜XÝÜ’Y›ÛNˆ^XÝYœ›ÛK]]Üš]QÜ˜[YÎˆ×HNÂˆÛÛœÝXÝX[H[™Ú[™K˜\JÝ]KXÝÜ‹^XÝY˜XÝ[ÛŠNÂˆYˆ
XÝX[œ™XÙZ\œ™XÙZ\\ÚOOH^XÝYœ™XÙZ\\Ú
H™]\›ˆØš™XÝ™œ™Y^™JÈÛÛ™›Ü›X[ˆ˜[ÙKÝ]K^XÝYˆ^XÝYœ™XÙZ\\ÚXÝX[ˆXÝX[œ™XÙZ\œ™XÙZ\\ÚJNÂˆÝ]HHXÝX[œÝ]NÂˆBˆ™]\›ˆØš™XÝ™œ™Y^™JÈÛÛ™›Ü›X[ˆYKÝ]K™XÙZ\XYˆ[™Ú[™K›YÙ\‹˜[

K˜]
LJOËœ™XÙZ\\ÚÏÈ[JNÂŸB‚‹ËÈKKKHÞ[XXÝšœÈKKKB™^ÜÛ\ÜÈ”‘Þ[Q[š\›Û›Y[ÂˆÛÛœÝXÝÜŠÛÛ™šYË[™Ú[™K™\šYšY\ˆH™]ÈÝ]TÜÝÛÛ™][Û•™\šYšY\Š
JHÈ\Ë˜ÛÛ™šYÈHÛÛ™šYÎÈ\Ë™[™Ú[™HH[™Ú[™NÈ\Ë™\šYšY\ˆH™\šYšY\ŽÈ\ËœÝ]HHÝXÝ\™YÛÛ™JÛÛ™šYËš[š]X[Ý]JNÈBˆØœÙ\™J
HÈ™]\›ˆØš™XÝ™œ™Y^™JÈ\\ÛÙRYˆ\Ë˜ÛÛ™šYË™\\ÛÙRYÝ]NˆÝXÝ\™YÛÛ™J\ËœÝ]JK™XÙZ\XYˆ\Ë™[™Ú[™K›YÙ\‹˜[

K˜]
LJOËœ™XÙZ\\ÚÏÈ[JNÈBˆXÝ
XÝ[ÛŠHÈÛÛœÝ™\Ý[]\Ë™[™Ú[™K˜\J\ËœÝ]K\Ë˜ÛÛ™šYË˜XÝÜ‹XÝ[ÛŠNÈ\ËœÝ]O\™\Ý[œÝ]NÈ™]\›ˆØš™XÝ™œ™Y^™JÈYZ]Yœ™\Ý[˜YZ]Y‹‹Š™\Ý[œ™Y\Ø[ÞÜ™Y\Ø[œ™\Ý[œ™Y\Ø[NžßJKØœÙ\˜][ÛŽ\Ë›ØœÙ\™J
K™XÙZ\œ™\Ý[œ™XÙZ\JNÈBˆ™\šYžJ^XÝY
HÈÛÛœÝØœÙ\™Y]\Ë›ØœÙ\™J
NÈÛÛœÝYÛY[]\Ë™\šYšY\‹™\šYžJØœÙ\™Y^XÝY
NÈ™]\›ˆØš™XÝ™œ™Y^™JÈ‹‹šYÛY[ØœÙ\™YJNÈBˆÚXÚÜÚ[

HÈ™]\›ˆ”ÓÓ‹œÝš[™ÚYžJ\ËœÝ]JNÈBˆ™\ÝÜ™JÚXÚÜÚ[
HÈÛÛœÝ\œÙYR”ÓÓ‹œ\œÙJÚXÚÜÚ[
NÈYŠ\œÙY›YY][™ÒYOO]\ËœÝ]K›YY][™ÒY\œÙYœ[\Ù]YOO]\ËœÝ]Kœ[\Ù]Y
H›ÝÈ™]È\œ›ÜŠ”‘Q•TÑQÒPÒÔÒS•ÒQS•UWÓRTÓPUÒŠNÈ\ËœÝ]OSØš™XÝ™œ™Y^™J\œÙY
NÈBŸB‚‹ËÈKKKH›ÝšY\‹šœÈKKKB™^ÜÛ\ÜÈ”‘Þ[T›ÝšY\ˆÂˆÛÛœÝXÝÜŠÈ[\Ù]]]Üš]K™\šYšY\ˆJHÈ\Ëœ[\Ù]H[\Ù]È\Ë˜]]Üš]HH]]Üš]NÈ\Ë™\šYšY\ˆH™\šYšY\ŽÈBˆX]\šX[^™JÈ\\ÛÙRY[š]X[Ý]KXÝÜˆJHÂˆYˆ
[š]X[Ý]Kœ[\Ù]YOOH\Ëœ[\Ù]šY
H›ÝÈ™]È\œ›ÜŠ”‘Q•TÑQ”•STÑUÒQS•UWÓRTÓPUÒŠNÂˆÛÛœÝ[™Ú[™HH™]È\›X[Y[\žQ[™Ú[™J\Ëœ[\Ù]\Ë˜]]Üš]JNÈ™]\›ˆ™]È”‘Þ[Q[š\›Û›Y[
È\\ÛÙRY[š]X[Ý]KXÝÜˆK[™Ú[™K\Ë™\šYšY\ŠNÂˆBŸB