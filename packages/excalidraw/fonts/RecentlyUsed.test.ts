import { RecentlyUsed } from "./RecentlyUsed";

describe("RecentlyUsed", () => {
  let dropped: string[];
  let made: string[];
  let cache: RecentlyUsed<string>;

  const take = (key: string) =>
    cache.take(key, () => {
      made.push(key);
      return `face of ${key}`;
    });

  beforeEach(() => {
    dropped = [];
    made = [];
    cache = new RecentlyUsed<string>(2, (value) => dropped.push(value));
  });

  it("makes a value the first time its key is taken", () => {
    expect(take("wght300")).toBe("face of wght300");
  });

  it("makes a value once however often its key is taken", () => {
    take("wght300");
    take("wght300");
    expect(made).toEqual(["wght300"]);
  });

  it("drops nothing while it holds no more than its limit", () => {
    take("wght300");
    take("wght800");
    cache.trim(new Set());
    expect(dropped).toEqual([]);
  });

  it("drops the value taken longest ago past its limit", () => {
    take("wght300");
    take("wght800");
    take("BNCE40");
    cache.trim(new Set());
    expect(dropped).toEqual(["face of wght300"]);
  });

  it("counts a value taken again as recent", () => {
    take("wght300");
    take("wght800");
    take("wght300");
    take("BNCE40");
    cache.trim(new Set());
    expect(dropped).toEqual(["face of wght800"]);
  });

  it("never drops a value still in use, however old", () => {
    take("wght300");
    take("wght800");
    take("BNCE40");
    cache.trim(new Set(["wght300"]));
    expect(dropped).toEqual(["face of wght800"]);
  });

  it("holds more than its limit when all of them are in use", () => {
    take("wght300");
    take("wght800");
    take("BNCE40");
    cache.trim(new Set(["wght300", "wght800", "BNCE40"]));
    expect(cache.size).toBe(3);
  });

  it("makes a dropped value again when its key is taken", () => {
    take("wght300");
    take("wght800");
    take("BNCE40");
    cache.trim(new Set());
    take("wght300");
    expect(made).toEqual(["wght300", "wght800", "BNCE40", "wght300"]);
  });
});
