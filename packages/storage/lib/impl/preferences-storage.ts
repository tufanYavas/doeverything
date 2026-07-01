import { createStorage, StorageEnum } from '../base/index.js';
import type { PermissionMode, PreferencesState } from './brand-types.js';
import type { BaseStorageType } from '../base/types.js';

const STORAGE_KEY = 'doe:preferences';

const DEFAULT_STATE: PreferencesState = {
  permissionMode: 'ask',
  screenshotMode: 'auto',
  locale: 'en',
};

const storage = createStorage<PreferencesState>(STORAGE_KEY, DEFAULT_STATE, {
  storageEnum: StorageEnum.Local,
  liveUpdate: true,
});

export interface PreferencesStorageType extends BaseStorageType<PreferencesState> {
  setPermissionMode: (mode: PermissionMode) => Promise<void>;
  setLocale: (locale: string) => Promise<void>;
  setScreenshotMode: (mode: PreferencesState['screenshotMode']) => Promise<void>;
}

export const preferencesStorage: PreferencesStorageType = {
  ...storage,
  setPermissionMode: mode => storage.set(prev => ({ ...prev, permissionMode: mode })),
  setLocale: locale => storage.set(prev => ({ ...prev, locale })),
  setScreenshotMode: mode => storage.set(prev => ({ ...prev, screenshotMode: mode })),
};
