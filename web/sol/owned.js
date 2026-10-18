// Which accounts of the approvals program pay a fee key (SOL-52): the Worker asks the RPC for them
// with these filters, and the fake chain of the tests applies the same filters. This file has no
// import, so Node tests load it as it is.

/**
 * The parts of an open proposal of `group` that pays `fee` (both hex), as [byte offset, hex]: kind
 * 1, the group key at byte 34 and the rent recipient at byte 74 (sol-program/src/state.rs).
 */
export const proposalMatch = (group, fee) => [
  [0, "01"],
  [34, group],
  [74, fee],
];

const base64Of = (hex) =>
  btoa(String.fromCharCode(...(hex.match(/../g) ?? []).map((byte) => parseInt(byte, 16))));

/**
 * The RPC `memcmp` filters of `proposalMatch`, with base64 bytes. The Worker gives the offsets to
 * the SDK as BigInt; a JSON client sends them as they are.
 */
export const proposalFilters = (group, fee) =>
  proposalMatch(group, fee).map(([offset, hex]) => ({
    memcmp: { offset, bytes: base64Of(hex), encoding: "base64" },
  }));
