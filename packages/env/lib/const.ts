export const IS_DEV = process.env['CLI_DOE_DEV'] === 'true';
export const IS_PROD = !IS_DEV;
export const IS_CI = process.env['DOE_CI'] === 'true';
