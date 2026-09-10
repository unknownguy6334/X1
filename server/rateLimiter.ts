export class SlidingWindowRateLimiter {
  private readonly buckets = new Map<string, number[]>();
  constructor(private readonly limit: number, private readonly windowMs: number, private readonly maxKeys = 10_000) {}

  allow(key: string): { allowed: boolean; retryAfterSeconds: number } {
    const now = Date.now();
    const cutoff = now - this.windowMs;
    const current = (this.buckets.get(key) || []).filter((ts) => ts > cutoff);
    if (current.length >= this.limit) {
      const retryAfterSeconds = Math.max(1, Math.ceil((current[0] + this.windowMs - now) / 1000));
      this.buckets.set(key, current);
      this.prune(cutoff);
      return { allowed: false, retryAfterSeconds };
    }
    current.push(now);
    this.buckets.set(key, current);
    this.prune(cutoff);
    return { allowed: true, retryAfterSeconds: 0 };
  }

  private prune(cutoff: number): void {
    if (this.buckets.size <= this.maxKeys) return;
    for (const [key, timestamps] of this.buckets) {
      if (!timestamps.some((ts) => ts > cutoff)) this.buckets.delete(key);
    }
    if (this.buckets.size <= this.maxKeys) return;
    const staleKeys = Array.from(this.buckets.entries())
      .sort((a, b) => (a[1][a[1].length - 1] || 0) - (b[1][b[1].length - 1] || 0))
      .slice(0, this.buckets.size - this.maxKeys);
    for (const [key] of staleKeys) this.buckets.delete(key);
  }
}
