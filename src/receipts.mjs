import { digest } from './canonical.mjs';
import { Standing } from './model.mjs';

export function makeReceipt(before, action, after, consequence) {
  const body = { schema: 'urn:rrgym:receipt:v1', meetingId: before.meetingId, sequence: after.sequence, previousReceiptDigest: before.receiptChain.at(-1)?.receiptDigest ?? null, beforeDigest: digest(before), actionDigest: digest(action), consequence, afterDigest: digest({ ...after, receiptChain: before.receiptChain }) };
  return Object.freeze({ ...body, receiptDigest: digest(body) });
}

export function verifyReceiptChain(world) {
  let prior = null;
  for (const receipt of world.receiptChain) {
    const { receiptDigest, ...body } = receipt;
    if (digest(body) !== receiptDigest) return { standing: Standing.REFUSED, code: 'REFUSED_RECEIPT_DIGEST' };
    if (body.previousReceiptDigest !== prior) return { standing: Standing.REFUSED, code: 'REFUSED_RECEIPT_CHAIN' };
    prior = receiptDigest;
  }
  return { standing: Standing.ALIVE, receipts: world.receiptChain.length };
}
