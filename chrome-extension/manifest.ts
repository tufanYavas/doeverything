import { readFileSync } from 'node:fs';
import type { ManifestType } from '@doeverything/shared';

const packageJson = JSON.parse(readFileSync('./package.json', 'utf8'));

const manifest = {
  manifest_version: 3,
  minimum_chrome_version: '116',
  default_locale: 'en',
  name: '__MSG_extensionName__',
  version: packageJson.version,
  description: '__MSG_extensionDescription__',
  homepage_url: 'https://doeverythi.ng',
  icons: {
    '16': 'icon-16.png',
    '32': 'icon-32.png',
    '48': 'icon-48.png',
    '128': 'icon-128.png',
  },

  action: {
    default_title: '__MSG_actionTitle__',
    default_icon: {
      '16': 'icon-16.png',
      '32': 'icon-32.png',
      '48': 'icon-48.png',
    },
  },

  options_page: 'options/index.html',

  background: {
    service_worker: 'background.js',
    type: 'module',
  },

  // No default side-panel path: the side panel is opt-in per tab.
  // chrome.sidePanel.setOptions({tabId, path, enabled}) is called by the SW
  // only for tabs that belong to the doeverything tab group, so the panel never
  // auto-opens on tabs the agent isn't driving.

  commands: {
    'toggle-side-panel': {
      suggested_key: {
        default: 'Alt+G',
        mac: 'Command+E',
      },
      description: '__MSG_commandToggleSidePanel__',
    },
    'new-conversation': {
      suggested_key: {
        default: 'Ctrl+Shift+E',
        mac: 'Command+Shift+E',
      },
      description: 'Start a new doeverything conversation',
    },
    'stop-agent': {
      // No suggested_key — Chrome only allows 4 suggested keys per extension.
      description: 'Stop the running doeverything agent',
    },
    'open-options': {
      description: 'Open doeverything settings',
    },
  },

  permissions: [
    'sidePanel',
    'storage',
    'activeTab',
    'scripting',
    'debugger',
    'tabGroups',
    'tabs',
    'alarms',
    'notifications',
    'webNavigation',
    'offscreen',
    'unlimitedStorage',
    'downloads',
  ],

  host_permissions: ['<all_urls>'],

  storage: {
    managed_schema: 'managed_schema.json',
  },

  content_scripts: [
    {
      // doeverything visual indicator (terracotta glow + Stop pill).
      matches: ['http://*/*', 'https://*/*'],
      js: ['content/indicator.iife.js'],
      run_at: 'document_idle',
      world: 'ISOLATED',
      all_frames: false,
    },
    {
      // doeverything MAIN-world DOM walker (`window.___oadp`).
      matches: ['http://*/*', 'https://*/*'],
      js: ['content/mainworld.iife.js'],
      run_at: 'document_start',
      world: 'MAIN',
      all_frames: false,
    },
    {
      // doeverything in-page event recorder. Idle by default; activates only
      // while a recording is in progress (gated by chrome.storage.local).
      matches: ['http://*/*', 'https://*/*'],
      js: ['content/recorder.iife.js'],
      run_at: 'document_idle',
      world: 'ISOLATED',
      all_frames: false,
    },
    {
      // doeverything element/region selector overlay. Dormant
      // until the SW broadcasts `doe/selector/start`.
      matches: ['http://*/*', 'https://*/*'],
      js: ['content/selector.iife.js'],
      run_at: 'document_idle',
      world: 'ISOLATED',
      all_frames: false,
    },
    {
      matches: ['http://*/*', 'https://*/*'],
      css: ['content.css'],
    },
  ],

  web_accessible_resources: [
    {
      resources: [
        'side-panel/index.html',
        'options/index.html',
        'blocked/index.html',
        'gif-viewer/index.html',
        'offscreen/index.html',
        '*.js',
        '*.css',
        '*.svg',
        'icon-16.png',
        'icon-32.png',
        'icon-48.png',
        'icon-128.png',
        'icon-512.png',
        'icon-34.png',
        // Built-in SKILL.md files seeded into chrome.storage on install
        // (chrome-extension/skills/*.md). Need to be web-accessible so the
        // SW can fetch them via `chrome.runtime.getURL`.
        'skills/*.md',
      ],
      matches: ['*://*/*'],
      // @ts-expect-error use_dynamic_url is valid Chrome MV3 but missing from @types/chrome
      use_dynamic_url: false,
    },
  ],
} satisfies ManifestType;

export default manifest;
