// Review the compact popup over actual app renderers with synthetic state and no wallet boot.
import { createMenuPreviewServer } from './network_privacy_menu_preview.mjs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
export const createDemoServer = createMenuPreviewServer;
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { origin } = await createDemoServer(Number(process.env.PRIVACY_DEMO_PORT || 4194));
  console.log(`Landing-page privacy popup preview: ${origin}/`);
}
