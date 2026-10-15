// Entry script of the Worker in the mock run. The mock RPC server is on loopback, which the
// product guard refuses, so this script turns on the test mode of guard.js and then loads the
// shipped /sol/worker.js unchanged. The product page starts /sol/worker.js directly, never this.
// Static imports only, so that onmessage is set before the first message is delivered.
import { allowLoopbackForTests } from "/sol/guard.js";
import "/sol/worker.js";

allowLoopbackForTests();
