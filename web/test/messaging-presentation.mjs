// Real redraw helpers: keep independent drafts/scrolls in this tab without restoring another
// contact's disclosure or a replaced account's plaintext into the new view.
import assert from "node:assert/strict";
import { loadRig } from "./sol-rig.mjs";

const { t } = await loadRig();
const {
  clearMessageDraft, clearMessagingPresentation, messagingAccountScope, restoreFormState,
  saveFormState, typingMessage,
} = await import("../app-loop.js");
const originalDocument = globalThis.document, ids = new Map();
const field = (id, value = "", scope = null) => ({
  id, value, type: "textarea", dataset: {},
  getAttribute: (key) => key === "data-account-scope" ? scope : null,
  dispatchEvent() {},
});
const log = (id, scrollTop, scope = null) => ({
  id, scrollTop, scrollHeight: 1000, clientHeight: 200,
  getAttribute: (key) => key === "data-account-scope" ? scope : null,
});
const disclosure = (scope, open = false) => ({ textContent: "Conversation details",
  parentElement: { dataset: { disclosureKey: scope }, open } });
const page = (fields = [], logs = [], disclosures = []) => {
  for (const item of fields) ids.set(item.id, item);
  return {
    querySelector: () => null,
    querySelectorAll(selector) {
      if (selector === "input[id], select[id], textarea[id]") return fields;
      if (selector === ".chat-log") return logs;
      if (selector === "details[open] > summary") return disclosures.filter((d) => d.parentElement.open);
      if (selector === "details > summary") return disclosures;
      return [];
    },
  };
};
const mount = (...args) => { ids.clear(); return page(...args); };
globalThis.document = { getElementById: (id) => ids.get(id), activeElement: null };
try {
  clearMessagingPresentation();
  let a = field("chat-text-wallet-a", "Team draft"), aLog = log("log-wallet-a", 130);
  const savedA = saveFormState(mount([a], [aLog]));
  let b = field("chat-text-dm-b", "Direct draft"), bLog = log("log-dm-b", 270);
  restoreFormState(mount([b], [bLog]), savedA);
  assert.equal(b.value, "Direct draft", "a team draft never enters a direct chat");
  const savedB = saveFormState(page([b], [bLog]));
  a = field("chat-text-wallet-a"); aLog = log("log-wallet-a", 0);
  restoreFormState(mount([a], [aLog]), savedB);
  assert.equal(a.value, "Team draft", "returning to a conversation restores its draft");
  assert.equal(aLog.scrollTop, 130, "returning restores the reader's timeline position");

  clearMessageDraft(a.id, a.value);
  a.value = "";   // existing successful-send behavior clears the live composer too
  const sentA = saveFormState(page([a], [aLog]));
  b = field("chat-text-dm-b");
  restoreFormState(mount([b]), sentA);
  assert.equal(b.value, "Direct draft", "sending elsewhere keeps this draft");
  const returnToA = saveFormState(page([b]));
  a = field("chat-text-wallet-a");
  restoreFormState(mount([a]), returnToA);
  assert.equal(a.value, "", "a sent draft does not return on later navigation");

  t.setAcct({});
  const oldScope = messagingAccountScope();
  const oldBox = field("chat-text-oc-1", "Old account draft", oldScope);
  const oldLog = log("log-oc-1", 420, oldScope);
  const oldAccount = saveFormState(mount([oldBox], [oldLog]));
  t.setAcct({});
  const newScope = messagingAccountScope();
  assert.notEqual(newScope, oldScope);
  document.activeElement = oldBox;
  assert.equal(typingMessage({ contains: () => true }, []), false,
    "a focused old-account draft cannot delay the replacement account view");
  document.activeElement = null;
  saveFormState(page([oldBox], [oldLog]));   // old account DOM is still mounted at this moment
  const newBox = field("chat-text-oc-1", "", newScope), newLog = log("log-oc-1", 0, newScope);
  restoreFormState(mount([newBox], [newLog]), oldAccount);
  assert.equal(newBox.value, "", "account replacement never restores previous plaintext");
  assert.equal(newLog.scrollTop, 1000, "old account scroll does not enter the replacement");

  const detailA = disclosure("contact-a", true);
  const openA = saveFormState(mount([], [], [detailA]));
  const detailB = disclosure("contact-b"), sameA = disclosure("contact-a");
  restoreFormState(mount([], [], [detailB, sameA]), openA);
  assert.equal(detailB.parentElement.open, false, "same summary does not expose another contact");
  assert.equal(sameA.parentElement.open, true, "same conversation retains its disclosure");

  clearMessagingPresentation();
  for (let n = 0; n <= 100; n++) saveFormState(mount([field("chat-text-dm-" + n, "Draft " + n)]));
  const empty = saveFormState(mount());
  const oldest = field("chat-text-dm-0"), newest = field("chat-text-dm-100");
  restoreFormState(mount([oldest, newest]), empty);
  assert.equal(oldest.value, "", "old views are evicted from bounded tab memory");
  assert.equal(newest.value, "Draft 100");

  const lockedBox = field("chat-text-wallet-lock", "Private draft");
  saveFormState(mount([lockedBox]));
  document.activeElement = lockedBox;
  t.setLocked({ damaged: true });
  assert.equal(typingMessage({ contains: () => true }, []), false,
    "a focused composer cannot delay the lock view");
  const lockedForm = saveFormState(page([lockedBox]));
  t.setLocked(null);
  const unlockedBox = field(lockedBox.id);
  restoreFormState(mount([unlockedBox]), lockedForm);
  assert.equal(unlockedBox.value, "", "lock clears the tab's cached message text");
} finally {
  t.setLocked(null); clearMessagingPresentation();
  globalThis.document = originalDocument;
}
console.log("messaging-presentation: ok");
process.exit(0);
