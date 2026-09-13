// Shared happy-dom registration harness. Extracted from the repeated
// dynamic-import blocks (currently duplicated across ResultsShell, AreaModal,
// and ReportJsonModal tests) that register a real global document for tests
// that need actual browser DOM behavior instead of the plain domShim.

export interface HappyDomRegistrator {
  register: (options?: { url?: string }) => void;
  unregister: () => void;
}

let registrator: HappyDomRegistrator | null = null;

// Idempotent: a second call while already registered is a no-op, so nested
// describe blocks can each call this in beforeAll without double-registering.
export async function registerHappyDom(url = "http://localhost/"): Promise<void> {
  if (registrator !== null) {
    return;
  }
  const specifier: string = "@happy-dom/global-registrator";
  const mod = (await import(specifier)) as {
    GlobalRegistrator?: HappyDomRegistrator;
  };
  if (mod.GlobalRegistrator === undefined) {
    throw new Error(
      "happy-dom is installed but did not expose a GlobalRegistrator export. " +
        "Install the dev-only harness with `bun add -d happy-dom @happy-dom/global-registrator`.",
    );
  }
  registrator = mod.GlobalRegistrator;
  registrator.register({ url });
  Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
}

// Idempotent: safe to call even when nothing is registered.
export function teardownHappyDom(): void {
  registrator?.unregister();
  registrator = null;
}

// Drains one pending macrotask (a zero-delay-ish setTimeout tick) so tests
// can wait for happy-dom timers or deferred DOM updates without a busy loop.
export async function drainMacrotask(): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 5);
  });
}
