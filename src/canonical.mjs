import { createHash } from 'node:crypto';

export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    const fields = Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`);
    return `{${fields.join(',')}}`;
  }
  return JSON.stringify(value);
}

export function digest(value) {
  return createHash('sha256').update(canonical(value)).digest('hex');
}
