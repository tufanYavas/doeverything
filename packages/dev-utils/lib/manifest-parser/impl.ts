import type { IManifestParser } from './types.js';
import type { ManifestType } from '@doeverything/shared';

export const ManifestParserImpl: IManifestParser = {
  convertManifestToString: manifest => {
    return JSON.stringify(manifest, null, 2);
  },
};
