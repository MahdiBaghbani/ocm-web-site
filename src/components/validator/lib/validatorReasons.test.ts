import { describe, expect, test } from "bun:test";

import {
  VALIDATOR_REASONS,
  reasonCopyFor,
  titleizeSlug,
} from "./validatorReasons";

describe("jwks_unadvertised grade-specific outcome", () => {
  test("resolves to warn regardless of caller severity", () => {
    const fromFail = reasonCopyFor({ reasonCode: "jwks_unadvertised", severity: "fail" });
    const fromInfo = reasonCopyFor({ reasonCode: "jwks_unadvertised", severity: "info" });
    expect(fromFail.source).toBe("map");
    expect(fromFail.gradeSpecific).toBe(true);
    expect(fromFail.grade).toBe("warn");
    expect(fromInfo.grade).toBe("warn");
  });

  test("resolves to warn regardless of caller grade", () => {
    const fromFail = reasonCopyFor({ reasonCode: "jwks_unadvertised", grade: "fail" });
    const fromInfo = reasonCopyFor({ reasonCode: "jwks_unadvertised", grade: "info" });
    expect(fromFail.grade).toBe("warn");
    expect(fromInfo.grade).toBe("warn");
  });
});

describe("probed slugs are grade-agnostic", () => {
  const probed = ["discovery_probed", "tls_probed", "httpsig_probed"];

  for (const slug of probed) {
    test(`${slug} follows the caller outcome`, () => {
      const warned = reasonCopyFor({ reasonCode: slug, grade: "warn" });
      const failed = reasonCopyFor({ reasonCode: slug, grade: "fail" });
      expect(warned.source).toBe("map");
      expect(warned.gradeSpecific).toBe(false);
      expect(warned.grade).toBe("warn");
      expect(failed.grade).toBe("fail");
    });
  }
});

describe("titleizeSlug acronym awareness", () => {
  test("keeps JWKS uppercase and title-cases the rest", () => {
    expect(titleizeSlug("jwks_probed")).toBe("JWKS Probed");
  });

  test("title-cases an unknown slug", () => {
    expect(titleizeSlug("foo_bar")).toBe("Foo Bar");
  });
});

describe("well_known_ok is not a confirmed mapping", () => {
  test("falls through to the titleize fallback", () => {
    const resolved = reasonCopyFor({ reasonCode: "well_known_ok", grade: "pass" });
    expect(resolved.source).toBe("titleize");
    expect(resolved.title).toBe("Well Known Ok");
    expect(resolved.gradeSpecific).toBeUndefined();
    expect(resolved.affectsGrade).toBeUndefined();
  });
});

describe("missing and unknown slug fallbacks", () => {
  test("missing slug uses the conservative missing note without a remedy", () => {
    const noCode = reasonCopyFor({});
    const emptyCode = reasonCopyFor({ reasonCode: "   " });
    expect(noCode.source).toBe("missing");
    expect(noCode.title).toBe("Check note");
    expect(noCode.remedy).toBeUndefined();
    expect(emptyCode.source).toBe("missing");
    expect(emptyCode.title).toBe("Check note");
    expect(emptyCode.remedy).toBeUndefined();
  });

  test("unknown non-empty slug uses the titleize source", () => {
    const resolved = reasonCopyFor({ reasonCode: "foo_bar", grade: "info" });
    expect(resolved.source).toBe("titleize");
    expect(resolved.title).toBe("Foo Bar");
    expect(resolved.slug).toBe("foo_bar");
  });
});

describe("remedy is limited to warn or fail outcomes", () => {
  test("mapped probed slug shows a remedy only for warn and fail", () => {
    expect(reasonCopyFor({ reasonCode: "discovery_probed", grade: "pass" }).remedy).toBeUndefined();
    expect(reasonCopyFor({ reasonCode: "discovery_probed", grade: "info" }).remedy).toBeUndefined();
    expect(reasonCopyFor({ reasonCode: "discovery_probed", grade: "warn" }).remedy).toBeDefined();
    expect(reasonCopyFor({ reasonCode: "discovery_probed", grade: "fail" }).remedy).toBeDefined();
  });

  test("mapped remedy is suppressed when the reason does not affect the grade", () => {
    const suppressed = reasonCopyFor({
      reasonCode: "discovery_probed",
      grade: "warn",
      affectsGrade: false,
    });
    expect(suppressed.affectsGrade).toBe(false);
    expect(suppressed.remedy).toBeUndefined();
  });

  test("unknown fallback shows a remedy only for warn and fail", () => {
    expect(reasonCopyFor({ reasonCode: "foo_bar", grade: "pass" }).remedy).toBeUndefined();
    expect(reasonCopyFor({ reasonCode: "foo_bar", grade: "info" }).remedy).toBeUndefined();
    expect(reasonCopyFor({ reasonCode: "foo_bar", grade: "warn" }).remedy).toBeDefined();
    expect(reasonCopyFor({ reasonCode: "foo_bar", grade: "fail" }).remedy).toBeDefined();
  });
});

describe("confirmed reason map", () => {
  test("all four entries affect the grade", () => {
    const keys = Object.keys(VALIDATOR_REASONS);
    expect(keys).toHaveLength(4);
    expect(keys.sort()).toEqual(
      ["discovery_probed", "httpsig_probed", "jwks_unadvertised", "tls_probed"],
    );
    for (const key of keys) {
      expect(VALIDATOR_REASONS[key].affectsGrade).toBe(true);
    }
  });
});
