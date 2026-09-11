import { describe, expect, test } from "bun:test";
import { subnavAriaCurrent } from "./validatorSubnav";

describe("subnavAriaCurrent", () => {
  test("marks the active section current and others undefined", () => {
    expect(subnavAriaCurrent("test", "test")).toBe("page");
    expect(subnavAriaCurrent("test", "statistics")).toBeUndefined();
    expect(subnavAriaCurrent("statistics", "statistics")).toBe("page");
    expect(subnavAriaCurrent("statistics", "test")).toBeUndefined();
  });
});
