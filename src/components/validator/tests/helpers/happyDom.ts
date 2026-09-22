// Shared happy-dom registration harness. Extracted from the dynamic-import
// blocks previously inlined in ResultsShell, AreaModal, and ReportJsonModal
// tests; those tests now import this helper instead. Registers a real global
// document for tests that need actual browser DOM behavior instead of the
// plain domShim.

export interface HappyDomRegistrator {
  register: (options?: { url?: string }) => void;
  unregister: () => Promise<void>;
}

function isDomRegistrator(value: unknown): value is HappyDomRegistrator {
  if ((typeof value !== "object" && typeof value !== "function") || value === null) {
    return false;
  }
  if (!("register" in value) || typeof value.register !== "function") return false;
  if (!("unregister" in value) || typeof value.unregister !== "function") return false;
  return true;
}

let registrator: HappyDomRegistrator | null = null;
let priorActEnvironmentPresent = false;
let priorActEnvironment: unknown = undefined;

// Idempotent: a second call while already registered is a no-op, so nested
// describe blocks can each call this in beforeAll without double-registering.
export async function registerHappyDom(
  url = "http://localhost/",
  label?: string,
): Promise<void> {
  if (registrator !== null) {
    return;
  }
  const specifier: string = "@happy-dom/global-registrator";
  let mod: unknown;
  try {
    mod = await import(specifier);
  } catch (cause) {
    const installHint =
      "Install the dev-only harness with `bun add -d happy-dom @happy-dom/global-registrator` and re-run `bun test`.";
    throw new Error(
      label === undefined
        ? `happy-dom global registrator failed to load. ${installHint}`
        : `${label} needs a DOM environment. ${installHint}`,
      { cause },
    );
  }
  if (
    typeof mod !== "object" ||
    mod === null ||
    !("GlobalRegistrator" in mod) ||
    !isDomRegistrator(mod.GlobalRegistrator)
  ) {
    throw new Error("happy-dom is installed but did not expose a GlobalRegistrator export.");
  }
  registrator = mod.GlobalRegistrator;
  priorActEnvironmentPresent = Reflect.has(globalThis, "IS_REACT_ACT_ENVIRONMENT");
  priorActEnvironment = priorActEnvironmentPresent
    ? Reflect.get(globalThis, "IS_REACT_ACT_ENVIRONMENT")
    : undefined;
  registrator.register({ url });
  Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
}

// Idempotent: safe to call even when nothing is registered.
export async function teardownHappyDom(): Promise<void> {
  if (registrator === null) {
    return;
  }
  const current = registrator;
  await current.unregister();
  registrator = null;
  if (priorActEnvironmentPresent) {
    Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", priorActEnvironment);
  } else {
    Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
  }
}

// Drains one pending macrotask (a zero-delay-ish setTimeout tick) so tests
// can wait for happy-dom timers or deferred DOM updates without a busy loop.
export async function drainMacrotask(): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 5);
  });
}
