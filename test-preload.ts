import { beforeEach } from "bun:test";

import { resetSharedRuntimeConfigForTests } from "./src/lib/siteRuntimeConfig";

beforeEach(() => {
  resetSharedRuntimeConfigForTests();
});
