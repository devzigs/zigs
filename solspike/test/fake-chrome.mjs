#!/usr/bin/env node
// A stand-in for Chrome in the harness tests (SOLSPIKE_CHROME). FAKE_CHROME_MODE is one of:
//   hang      never opens the debugging port
//   stubborn  never opens the port and ignores SIGTERM
//   exit      exits with code 3
//   badws     answers /json/version with a WebSocket address that refuses connections
//   slowws    answers /json/version with a WebSocket address that never finishes the handshake
//   mute      accepts connections on the debugging port and never answers
import http from "node:http";
import net from "node:net";

const arg = process.argv.find((a) => a.startsWith("--remote-debugging-port="));
const port = Number(arg?.split("=")[1]);
const info = (wsPort) =>
  JSON.stringify({ Browser: "Fake/1", webSocketDebuggerUrl: `ws://127.0.0.1:${wsPort}/x` });
const answer = (wsPort) => {
  http.createServer((req, res) => res.end(info(wsPort))).listen(port, "127.0.0.1");
};
const stay = () => setInterval(() => {}, 1000);

const MODES = {
  hang: stay,
  stubborn: () => {
    process.on("SIGTERM", () => {});
    stay();
  },
  exit: () => process.exit(3),
  mute: () => net.createServer(() => {}).listen(port, "127.0.0.1"),
  badws: () => answer(1),
  slowws: () => {
    const mute = net.createServer(() => {});
    mute.listen(0, "127.0.0.1", () => answer(mute.address().port));
  },
};

const start = MODES[process.env.FAKE_CHROME_MODE];
if (!start) throw new Error(`FAKE_CHROME_MODE is "${process.env.FAKE_CHROME_MODE}"`);
start();
