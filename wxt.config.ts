import { defineConfig } from 'wxt';

export default defineConfig({
  manifest: {
    manifest_version: 2,
    name: 'Hermes Safari Bridge',
    description: 'Lets the local Hermes daemon (127.0.0.1:52800) drive this Safari: navigate, read, click, fill, screenshot.',
    version: '0.1.0',
    icons: { 128: 'icon-128.png' },
    permissions: ['tabs', 'storage', '<all_urls>'],
    browser_specific_settings: { safari: { strict_min_version: '16.4' } },
    background: { scripts: ['background.js'] },
    browser_action: { default_title: 'Hermes Safari Bridge' },
  },
});
