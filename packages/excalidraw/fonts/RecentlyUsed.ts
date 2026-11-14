/**
 * Keeps the values asked for most recently, by key, and lets go of the rest:
 * once more than `limit` are held, those asked for longest ago are dropped,
 * except the ones the caller is still using.
 */
export class RecentlyUsed<Value> {
  private readonly held = new Map<string, Value>();

  constructor(
    private readonly limit: number,
    private readonly drop: (value: Value) => void,
  ) {}

  /** The value held for `key`, made when it is not held, now the most recent. */
  public take(key: string, make: () => Value): Value {
    const value = this.held.has(key) ? this.held.get(key)! : make();
    this.held.delete(key);
    this.held.set(key, value);
    return value;
  }

  /** Drops the oldest values past the limit, never one of `inUse`. */
  public trim(inUse: ReadonlySet<string>): void {
    for (const [key, value] of this.held) {
      if (this.held.size <= this.limit) {
        return;
      }
      if (!inUse.has(key)) {
        this.held.delete(key);
        this.drop(value);
      }
    }
  }

  public get size() {
    return this.held.size;
  }
}
