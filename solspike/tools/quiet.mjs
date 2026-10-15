// The hasher package of the Zolana repo prints one fixed warning when it starts in Node: it takes
// its wasm module in the old parameter style. The repo is read only, so the warning cannot be
// fixed here. This drops that one line and every other message stays. Import it first.
const KNOWN = "using deprecated parameters for the initialization function";
const warn = console.warn.bind(console);
console.warn = (...args) => {
  if (!String(args[0]).startsWith(KNOWN)) warn(...args);
};
