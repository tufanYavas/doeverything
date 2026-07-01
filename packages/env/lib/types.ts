import type { dynamicEnvValues } from './index.js';

interface IDoeEnv {
  readonly DOE_DEV_LOCALE: string;
  readonly DOE_CI: string;

  readonly DOE_RELAY_BASE_URL: string;
  readonly DOE_LOCAL_FEATURE_FLAGS: string;
  readonly DOE_FEATURE_FLAGS_URL: string;
  readonly DOE_DISABLE_ANALYTICS: string;
  readonly DOE_SEGMENT_WRITE_KEY: string;
  readonly DOE_SENTRY_DSN: string;
}

interface IDoeCliEnv {
  readonly CLI_DOE_DEV: string;
}

export type EnvType = IDoeEnv & IDoeCliEnv & typeof dynamicEnvValues;
