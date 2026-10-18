// The mock run of a live scenario (--mock): the same pages and steps, and no Devnet call. The Node
// tools refuse the Helius URL and the funder key (tools/paths.mjs), Chrome resolves the Helius
// host to nothing, and the dev server gets a Helius URL with no key. A step that needs the chain
// goes into the plan of the run and is not sent.
import { setDevVar } from "./server.mjs";

export const MOCK = process.argv.includes("--mock");
export const HELIUS_HOST = "devnet.helius-rpc.com";
const MOCK_URL = `https://${HELIUS_HOST}/?api-key=mock-run`;

if (MOCK) {
  process.env.SOLSPIKE_MOCK = "1";
  process.env.SOLSPIKE_HOST_RULES = `MAP ${HELIUS_HOST} ~NOTFOUND`;
}

/** Runs `body` with the mock Helius URL in cf/.dev.vars (the server reads it when it starts). */
export async function withMockUrl(body) {
  if (!MOCK) return body();
  const old = setDevVar("HELIUS_DEVNET_URL", MOCK_URL);
  try {
    return await body();
  } finally {
    setDevVar("HELIUS_DEVNET_URL", old);
  }
}

/** The answers that the pages got from the Helius host: a mock run must have none. */
export const heliusAnswers = (pages) =>
  pages
    .flatMap((page) => page.records)
    .filter((r) => r.kind === "response" && new URL(r.url).hostname === HELIUS_HOST).length;
