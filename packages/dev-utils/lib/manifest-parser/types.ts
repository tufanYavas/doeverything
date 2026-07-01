import type { ManifestType } from '@doeverything/shared';

export interface IManifestParser {
  convertManifestToString: (manifest: ManifestType) => string;
}
