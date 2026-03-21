import {staticFile} from 'remotion';

const PASSTHROUGH_PATTERN = /^(data:|https?:|blob:|file:)/i;

export const resolveAssetSrc = (
  src: string,
  staticFileImpl: (path: string) => string = staticFile,
): string => {
  const trimmed = src.trim();
  if (!trimmed || PASSTHROUGH_PATTERN.test(trimmed)) {
    return trimmed;
  }

  return staticFileImpl(trimmed.replace(/^\/+/, ''));
};
