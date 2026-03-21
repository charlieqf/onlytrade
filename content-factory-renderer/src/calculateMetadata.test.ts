import {describe, expect, it} from 'vitest';

import {calculateSegmentMetadata} from './calculateMetadata';

describe('calculateSegmentMetadata', () => {
  it('uses the audio duration, portrait size, and 34/33/33 scene buckets', () => {
    const metadata = calculateSegmentMetadata({
      audioDurationInSeconds: 10,
      fps: 30,
    });

    expect(metadata.durationInFrames).toBe(300);
    expect(metadata.width).toBe(1080);
    expect(metadata.height).toBe(1920);
    expect(metadata.sceneDurationsInFrames).toEqual([102, 99, 99]);
    expect(metadata.sceneWindows).toEqual([
      {from: 0, durationInFrames: 102},
      {from: 102, durationInFrames: 99},
      {from: 201, durationInFrames: 99},
    ]);
  });
});
