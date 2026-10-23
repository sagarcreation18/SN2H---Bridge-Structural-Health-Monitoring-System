export const fail = (message, status = 400) =>
  Object.assign(new Error(message), { status });
export function number(value, min, max, name) {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < min ||
    value > max
  )
    throw fail(`${name} must be a number from ${min} to ${max}`);
  return value;
}
export function range(q) {
  const from = q.from ? new Date(q.from) : new Date(Date.now() - 86400000),
    to = q.to ? new Date(q.to) : new Date();
  if (!Number.isFinite(+from) || !Number.isFinite(+to) || from > to)
    throw fail("Invalid date range");
  const page = Number(q.page || 1),
    limit = Number(q.limit || 200);
  if (
    !Number.isSafeInteger(page) ||
    page > 1000000 ||
    page < 1 ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 1000
  )
    throw fail("Invalid pagination (limit 1–1000)");
  return { from, to, page, limit, offset: (page - 1) * limit };
}
export const asyncRoute = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);
export function validateHealth(health) {
  if (health === undefined) return undefined;
  if (!health || typeof health !== "object" || Array.isArray(health))
    throw fail("health must be an object");
  if (health.rssi !== undefined) number(health.rssi, -127, 0, "health.rssi");
  if (health.uptimeMs !== undefined)
    number(health.uptimeMs, 0, Number.MAX_SAFE_INTEGER, "health.uptimeMs");
  if (health.battery !== undefined)
    number(health.battery, 0, 100, "health.battery");
  if (
    health.firmware !== undefined &&
    (typeof health.firmware !== "string" || health.firmware.length > 80)
  )
    throw fail("Invalid firmware version");
  return health;
}
