import {describe, expect, it} from 'vitest';

import {
  buildCommentaryTimeline,
  buildDynamicCommentaryText,
  getCommentaryFrameState,
  splitCommentaryText,
} from './dynamicCommentary';

describe('dynamicCommentary', () => {
  it('splits commentary into short subtitle-sized sentences', () => {
    expect(
      splitCommentaryText(
        '真正值得看的是，Claude已经不只是聊天助手。它开始直接接管电脑操作，这会改变用户对AI工具边界的理解。接下来要看，这种控制能力会不会进入更日常的办公流程。',
      ),
    ).toEqual([
      '真正值得看的是，Claude已经不只是聊天助手。',
      '它开始直接接管电脑操作，这会改变用户对AI工具边界的理解。',
      '接下来要看，这种控制能力会不会进入更日常的办公流程。',
    ]);
  });

  it('builds longer dynamic subtitle text from reason plus script', () => {
    expect(
      buildDynamicCommentaryText({
        topicReason: '真正值得看的是，AI助手开始从聊天工具变成执行工具。',
        commentaryScript:
          '今天我们来聊聊 Claude 新功能。它已经不只是会聊天，而是开始直接控制电脑操作。接下来要看，这种能力会不会进入更常见的办公流程。',
      }),
    ).toBe(
      '真正值得看的是，AI助手开始从聊天工具变成执行工具。它已经不只是会聊天，而是开始直接控制电脑操作。接下来要看，这种能力会不会进入更常见的办公流程。',
    );
  });

  it('reveals the active subtitle line with a typewriter effect', () => {
    const timeline = buildCommentaryTimeline({
      commentaryText: '第一句评论。第二句评论更长一点。第三句收尾。',
      durationInFrames: 180,
    });

    const earlyState = getCommentaryFrameState({timeline, frame: 10});
    expect(earlyState.previousLines).toEqual([]);
    expect(earlyState.activeLine.length).toBeGreaterThan(0);
    expect(earlyState.activeLine.length).toBeLessThanOrEqual(3);
    expect(earlyState.activeLine.length).toBeLessThanOrEqual('第一句评论。'.length);

    const middleState = getCommentaryFrameState({timeline, frame: 24});
    expect(middleState.activeLine.length).toBeGreaterThan(earlyState.activeLine.length);

    const laterState = getCommentaryFrameState({timeline, frame: 130});
    expect(laterState.previousLines).toContain('第一句评论。');
    expect(laterState.activeLine.length).toBeGreaterThan(0);
  });
});
