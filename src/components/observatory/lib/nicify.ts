import type { FlowMetadata } from "./contracts";
import type { PlatformLabelResolver } from "./platformLabels";

/**
 * Format a cell ID as a human-readable title using flow labels and resolved
 * platform display names.
 *
 * Cell ID shape:
 *   Two-party:   `<flow_id>__<sender-platform>-<sender-version>__<receiver-platform>-<receiver-version>`
 *   Single-party: `<flow_id>__<platform>-<version>`
 *
 * @param platformLabel - Maps platform slug ids to display names (see
 *   `createPlatformLabelResolver`).
 *
 * @example
 * nicifyCellId(
 *   "share-with__nextcloud-v32__nextcloud-v32",
 *   [{ flow_id: "share-with", label: "Share With Flow", ... }],
 *   (platformId) => (platformId === "nextcloud" ? "Nextcloud" : platformId),
 * )
 * // => "Share With Flow: Nextcloud v32 to Nextcloud v32"
 *
 * @example
 * nicifyCellId(
 *   "login__nextcloud-v32",
 *   [{ flow_id: "login", label: "Login Flow", ... }],
 *   (platformId) => (platformId === "nextcloud" ? "Nextcloud" : platformId),
 * )
 * // => "Login Flow: Nextcloud v32"
 */
export function nicifyCellId(
  cellId: string,
  flows: FlowMetadata[],
  platformLabel: PlatformLabelResolver,
): string {
  if (!cellId) return cellId;

  try {
    const parts = cellId.split("__");
    if (parts.length < 2) return cellId;

    const flowId = parts[0]!;
    const senderStr = parts[1]!;
    const receiverStr = parts[2] ?? null;

    // Resolve flow label; fall back to sentence-casing the flow_id.
    const flowMeta = flows.find((f) => f.flow_id === flowId);
    let label: string;
    if (flowMeta) {
      label = flowMeta.label;
    } else {
      const readable = flowId.replace(/-/g, " ");
      label = readable.charAt(0).toUpperCase() + readable.slice(1);
    }

    // Split a "platform-version" pair string on the LAST hyphen so that
    // platform names containing hyphens (e.g. a hypothetical "foo-bar") are preserved.
    function splitPair(pair: string): [string, string] {
      const lastDash = pair.lastIndexOf("-");
      if (lastDash === -1) return [pair, ""];
      return [pair.slice(0, lastDash), pair.slice(lastDash + 1)];
    }

    const [senderPlatform, senderVersion] = splitPair(senderStr);
    const senderTitle = platformLabel(senderPlatform);

    if (receiverStr === null) {
      return `${label}: ${senderTitle} ${senderVersion}`;
    }

    const [receiverPlatform, receiverVersion] = splitPair(receiverStr);
    const receiverTitle = platformLabel(receiverPlatform);

    return `${label}: ${senderTitle} ${senderVersion} to ${receiverTitle} ${receiverVersion}`;
  } catch {
    return cellId;
  }
}

/** Parsed display components extracted from a Cypress screenshot path. */
export interface NicifiedScreenshotPath {
  /** e.g. "[01]" */
  index: string;
  /** e.g. "Sender" */
  role: string;
  /** e.g. "Authenticated" */
  state: string;
}

/**
 * Extract display components from a screenshot file path.
 *
 * Input path is the full artifact path or a bare filename; the function
 * derives the basename automatically. Expected filename shape after stripping
 * extension: `<cell-prefix>--<index>--<role>--<state>`.
 *
 * @example
 * nicifyScreenshotPath("share-with__nextcloud-v32__nextcloud-v32--001--sender--authenticated.png")
 * // => { index: "[01]", role: "Sender", state: "Authenticated" }
 *
 * @example
 * nicifyScreenshotPath("login__nextcloud-v32--002--receiver--invite-accepted.png")
 * // => { index: "[02]", role: "Receiver", state: "Invite Accepted" }
 */
export function nicifyScreenshotPath(path: string): NicifiedScreenshotPath {
  try {
    const basename = path.includes("/") ? (path.split("/").at(-1) ?? path) : path;
    const noExt = basename.replace(/\.(png|jpg|jpeg)$/i, "");
    const segs = noExt.split("--");

    if (segs.length < 4) {
      return { index: "[--]", role: "Unknown", state: noExt };
    }

    const rawIndex = segs[1]!;
    const rawRole = segs[2]!;
    // Remaining segments beyond index and role form the state string.
    const rawState = segs.slice(3).join("-");

    const index = /^\d+$/.test(rawIndex)
      ? `[${String(parseInt(rawIndex, 10)).padStart(2, "0")}]`
      : `[${rawIndex}]`;

    const role = rawRole.charAt(0).toUpperCase() + rawRole.slice(1).toLowerCase();

    const state = rawState
      .split("-")
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
      .join(" ");

    return { index, role, state };
  } catch {
    const basename = path.includes("/") ? (path.split("/").at(-1) ?? path) : path;
    const noExt = basename.replace(/\.(png|jpg|jpeg)$/i, "");
    return { index: "[--]", role: "Unknown", state: noExt };
  }
}
