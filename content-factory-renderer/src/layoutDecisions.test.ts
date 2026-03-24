import {describe, expect, it} from 'vitest';

import {getHeadlineTypography, getVisualPresentation} from './layoutDecisions';

describe('layoutDecisions', () => {
  it('reduces headline font size for longer social-video titles', () => {
    expect(getHeadlineTypography('华为Pura 70降价，北斗卫星消息引关注！')).toEqual({
      fontSize: 82,
      lineHeight: 1,
      lineClamp: 3,
    });
    expect(
      getHeadlineTypography('华为Pura 70降价至2999元，北斗卫星消息引关注，市场策略变化开始被重新定价').fontSize,
    ).toBe(72);
    expect(
      getHeadlineTypography('华为Pura 70降价至2999元，北斗卫星消息引关注，市场策略变化开始被重新定价').lineClamp,
    ).toBe(3);
  });

  it('shows generated cards in contain mode so card content is not cropped away', () => {
    expect(getVisualPresentation('article_image')).toEqual({fit: 'cover', inset: 0});
    expect(getVisualPresentation('generated_card')).toEqual({fit: 'contain', inset: 0});
  });
});
