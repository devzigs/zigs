// Tab-only presentation acknowledgement. It never authorizes an account or a transaction.
// The live account object identifies its lifetime without inspecting any private material.
const scopeOf = (contact, network) => JSON.stringify([contact.index, network, contact.address]);
const costOf = (plan) => JSON.stringify([plan.parts, plan.fee]);
const validPlan = (plan) => !plan.error && Number.isInteger(plan.parts) && plan.parts > 0
  && Number.isSafeInteger(plan.fee) && plan.fee > 0;

export function messagingCostReview() {
  let accounts = new WeakMap();
  return {
    needs(account, contact, network, plan) {
      return !account || !validPlan(plan)
        || accounts.get(account)?.get(scopeOf(contact, network)) !== costOf(plan);
    },
    remember(account, contact, network, plan) {
      if (!account || !validPlan(plan)) return;
      if (!accounts.has(account)) accounts.set(account, new Map());
      accounts.get(account).set(scopeOf(contact, network), costOf(plan));
    },
    clear() { accounts = new WeakMap(); },
  };
}
