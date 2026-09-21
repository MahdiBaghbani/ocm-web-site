import { describe, expect, test } from "bun:test";

import { reverseInviteErrorCopy } from "@/components/validator/islands/ResultsShell";
import { ACTION_ERROR_COPY } from "@/components/validator/lib/validatorGuidance";
import { type ValidatorFailure } from "@/components/validator/lib/validatorFetch";

function httpFailure(status: number, error: string, message: string): ValidatorFailure {
  return { ok: false, kind: "http", status, error, message };
}

describe("reverseInviteErrorCopy", () => {
  test("maps wrong_target_host, conflict, and missing_field reasonCodes to the shared paste_* guidance copy", () => {
    expect(
      reverseInviteErrorCopy(
        httpFailure(422, "wrong_target_host", "invite sender does not match the session target host"),
      ),
    ).toBe(ACTION_ERROR_COPY.paste_422_wrong_target_host);
    expect(
      reverseInviteErrorCopy(httpFailure(409, "conflict", "a different reverse invite is already imported")),
    ).toBe(ACTION_ERROR_COPY.paste_409_conflict);
    expect(reverseInviteErrorCopy(httpFailure(400, "missing_field", "invalid invite string"))).toBe(
      ACTION_ERROR_COPY.paste_400_invalid_invitation,
    );
  });

  test("falls back to the backend message for peer_unreachable, not_found, and internal_error", () => {
    expect(
      reverseInviteErrorCopy(
        httpFailure(502, "peer_unreachable", "failed to complete the reverse invite exchange"),
      ),
    ).toBe("failed to complete the reverse invite exchange");
    expect(reverseInviteErrorCopy(httpFailure(404, "not_found", "session not found"))).toBe(
      "session not found",
    );
    expect(reverseInviteErrorCopy(httpFailure(500, "internal_error", "failed to store invite"))).toBe(
      "failed to store invite",
    );
  });

  test("falls back to a generic message when the backend message is empty", () => {
    expect(reverseInviteErrorCopy(httpFailure(500, "internal_error", ""))).toBe(
      "Could not import the return invitation.",
    );
  });
});
