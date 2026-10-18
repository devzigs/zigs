// A stand-in for web/sol/prover/prover.js in worker.test.mjs: the key folder of the real bundle
// (prover-build.test.mjs checks that they are equal) and a ZolanaWebProver that records what the
// Worker asked for and answers from `proverControl`. Nothing here proves or reaches a network.
export const KEY_BASE_URL = "https://d3gbdb0egjwcw9.cloudfront.net/proving-keys/3a1c88f90f609eb1/";

export const proverControl = {
  /** The options of each prover that the Worker made. */
  made: [],
  /** The prove calls that reached the shim, and the test requests of the device check. */
  calls: [],
  /** The answer of the shim to a prove call. */
  reply: () => new Response('{"proof":"local"}', { status: 200 }),
  /** The answer of proveRequest (the device check). */
  proveRequest: async () => ({ proof: "{}", proveMs: 1, verifyMs: 1 }),
};

export class ZolanaWebProver {
  constructor(options) {
    proverControl.made.push(options);
  }

  createFetch() {
    return async (input, init) => {
      proverControl.calls.push({ url: String(input), body: init?.body });
      return proverControl.reply();
    };
  }

  proveRequest(body) {
    proverControl.calls.push({ selftest: body });
    return proverControl.proveRequest(body);
  }
}
