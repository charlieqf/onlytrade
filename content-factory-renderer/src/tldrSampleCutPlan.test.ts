import {describe, expect, it} from 'vitest';

import {clampCutaways, findActiveSubtitleCue, secondsToFrames} from './tldrSampleCutPlan';

describe('tldrSampleCutPlan', () => {
  it('converts seconds to frames', () => {
    expect(secondsToFrames(2.5, 30)).toBe(75);
  });

  it('clamps cutaways into valid frame windows', () => {
    expect(
      clampCutaways({
        cutaways: [
          {startSec: 2.5, endSec: 8, assetSrc: 'a.jpg'},
          {startSec: 28.5, endSec: 31, assetSrc: 'b.jpg'},
        ],
        fps: 30,
        durationInFrames: 900,
      }),
    ).toEqual([
      {startSec: 2.5, endSec: 8, assetSrc: 'a.jpg', from: 75, durationInFrames: 165},
      {startSec: 28.5, endSec: 31, assetSrc: 'b.jpg', from: 855, durationInFrames: 45},
    ]);
  });

  it('finds the active subtitle cue for a frame', () => {
    const cue = findActiveSubtitleCue({
      cues: [
        {startSec: 0, endSec: 2.5, text: '第一句'},
        {startSec: 2.5, endSec: 4.8, text: '第二句'},
      ],
      frame: 90,
      fps: 30,
    });

    expect(cue?.text).toBe('第二句');
  });
});
