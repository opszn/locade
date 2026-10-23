import metadata from '../package.json' with { type: 'json' };

export const APP_VERSION = metadata.version;
export const BUNDLE_VERSION = APP_VERSION.split('-')[0];
