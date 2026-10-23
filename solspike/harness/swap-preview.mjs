// Loaded only by the loopback development server, never by web/app.js.
import { renderSide, swapWorkspace } from '/app-shell.js';
import { createSwapPreview } from '/app-swap-preview.js';
import { MockSwapProvider } from '/swap-preview-model.js';
import { ui } from '/app-state.js';

ui.tab = 'swap'; renderSide();
const params = new URLSearchParams(location.search);
const scenario = params.get('scenario');
if (['dark', 'light'].includes(params.get('theme'))) document.documentElement.dataset.theme =
  params.get('theme');
const fixture = scenario === 'error' ? { fail: true } : scenario === 'unsupported' ? {
  unsupported: true }
  : scenario === 'balance' ? { balanceAtomic: '10000000' }
    : scenario === 'stale-balance' ? { staleBalance: true } : {};
if (scenario === 'before') {
  const before = await import('/__swap_before__.js');
  document.getElementById('app').replaceChildren(before.swapWorkspace());
} else {
  // Context is explicitly synthetic. No real wallet, secrets or engine are booted.
  const preview = createSwapPreview({ name: 'Example wallet · fixture',
    threshold: '2 of 3 device approvals per payment.' },
    new MockSwapProvider(fixture));
  document.getElementById('app').replaceChildren(preview.element);
  window.swapFixture = preview;
  window.swapProductionView = swapWorkspace;
}
document.getElementById('engine-text').textContent = 'Isolated UI fixture · engine not started';
// Importing the shared widgets also imports the app render loop. A background focus redraw
// must not replace this isolated fixture with the unbooted app's loading screen.
document.getElementById('app').replaceChildren = () => {};
window.swapHarnessReady = true;
