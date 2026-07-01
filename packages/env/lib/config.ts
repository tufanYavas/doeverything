import { config } from '@dotenvx/dotenvx';

export const baseEnv =
  config({
    path: `${import.meta.dirname}/../../../../.env`,
  }).parsed ?? {};

export const dynamicEnvValues = {
  DOE_NODE_ENV: baseEnv.DOE_DEV === 'true' ? 'development' : 'production',
} as const;
