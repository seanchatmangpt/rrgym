export const Standing = Object.freeze({ ALIVE: 'ALIVE', REFUSED: 'REFUSED' });
export const ActionKind = Object.freeze({ MOVE: 'MOVE', SECOND: 'SECOND', CALL_QUESTION: 'CALL_QUESTION', VOTE: 'VOTE', ADJOURN: 'ADJOURN' });

export function createWorld({ meetingId, members, chairId, quorum }) {
  if (!meetingId || !Array.isArray(members) || members.length === 0) throw new Error('INVALID_WORLD');
  if (!members.includes(chairId)) throw new Error('INVALID_CHAIR');
  if (!Number.isInteger(quorum) || quorum < 1 || quorum > members.length) throw new Error('INVALID_QUORUM');
  const roster = [...members].sort();
  return Object.freeze({
    schema: 'urn:rrgym:world:v1', meetingId, members: roster, chairId, quorum,
    present: roster, status: 'OPEN', sequence: 0, activeMotion: null, history: [], receiptChain: []
  });
}
