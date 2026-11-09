/** -1, 0 or 1. Missing or malformed parts count as 0, so "1.2" equals "1.2.0". */
export function compareVersions(a: string | null | undefined, b: string | null | undefined): number {
  const pa = String(a || '0').split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b || '0').split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length, 3); i += 1) {
    const x = pa[i] || 0;
    const y = pb[i] || 0;
    if (x !== y) return x > y ? 1 : -1;
  }
  return 0;
}

/** True when the installed build is older than the minimum the API still serves. */
export function needsUpdate(installed: string | null | undefined, minimum: string | null | undefined): boolean {
  if (!installed || !minimum) return false;
  return compareVersions(installed, minimum) < 0;
}
