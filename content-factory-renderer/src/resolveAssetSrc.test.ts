import {describe, expect, it, vi} from 'vitest';

import {resolveAssetSrc} from './resolveAssetSrc';

describe('resolveAssetSrc', () => {
  it('maps staged public assets through staticFile using a relative path', () => {
    const staticFileImpl = vi.fn((value: string) => `static:${value}`);

    expect(resolveAssetSrc('/t022-render-assets/smoke/visual-01.svg', staticFileImpl)).toBe(
      'static:t022-render-assets/smoke/visual-01.svg',
    );
    expect(staticFileImpl).toHaveBeenCalledWith('t022-render-assets/smoke/visual-01.svg');
  });

  it('passes through data and remote URLs unchanged', () => {
    const staticFileImpl = vi.fn((value: string) => `static:${value}`);

    expect(resolveAssetSrc('data:image/svg+xml;base64,abc', staticFileImpl)).toBe(
      'data:image/svg+xml;base64,abc',
    );
    expect(resolveAssetSrc('https://example.com/visual-01.svg', staticFileImpl)).toBe(
      'https://example.com/visual-01.svg',
    );
    expect(staticFileImpl).not.toHaveBeenCalled();
  });
});
