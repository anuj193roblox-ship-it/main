const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Runs fn and makes the whole call last at least minMs, whether it succeeds or throws.
 * Used so "wrong email" and "wrong password" take about the same time.
 */
export async function withMinDuration<T>(minMs: number, fn: () => Promise<T>): Promise<T> {
  const start = performance.now();
  try {
    return await fn();
  } finally {
    const left = minMs - (performance.now() - start);
    if (left > 0) await sleep(left);
  }
}
