/**
 * @fius/bundler
 *
 * Bundles Fius base images from fius.image.ts definitions
 * into importable packages exporting a typed `FiusImage` (no side effects).
 */

export { bundle } from './bundler.js';
export type { BundleOptions, BundleResult, GeneratedCode } from './types.js';
export type { ImageDefinition, ImageMetadata } from './image-definition/types.js';
