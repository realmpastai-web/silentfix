import { beforeAll, afterAll } from "vitest";

const originalFetch = globalThis.fetch;

beforeAll(() => {
  globalThis.fetch = async (input: RequestInfo | URL): Promise<Response> => {
    const url = String(input);
    throw new Error(`network disabled in tests: ${url}`);
  };
});

afterAll(() => {
  globalThis.fetch = originalFetch;
});
