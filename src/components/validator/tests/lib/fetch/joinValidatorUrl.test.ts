import { describe, expect, test } from "bun:test";

import { joinValidatorUrl } from "@/components/validator/lib/fetch/urls";

describe("joinValidatorUrl", () => {
  test("joins same-origin and absolute origins onto /validator", () => {
    expect(joinValidatorUrl("", "/start")).toBe("/validator/start");
    expect(joinValidatorUrl("https://api.example.com/", "/api/session/abc")).toBe(
      "https://api.example.com/validator/api/session/abc",
    );
  });
});
