import {renderToStaticMarkup} from 'react-dom/server';
import {beforeEach, describe, expect, it, vi} from 'vitest';

vi.mock('remotion', () => ({
  AbsoluteFill: ({children, ...props}: React.ComponentProps<'div'>) => <div {...props}>{children}</div>,
  Audio: ({src}: {src: string}) => <audio src={src} />,
  Img: ({src, ...props}: React.ComponentProps<'img'>) => <img src={src} {...props} />,
  Sequence: ({children}: {children: React.ReactNode}) => <>{children}</>,
  interpolate: () => 1,
  useCurrentFrame: () => 0,
  useVideoConfig: () => ({fps: 30, width: 1080, height: 1920}),
  staticFile: (value: string) => `static:${value}`,
}));

import {ContentFactorySegment} from './ContentFactorySegment';

describe('ContentFactorySegment', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders separate 30/40/30 headline, visual, and commentary regions', () => {
    const markup = renderToStaticMarkup(
      <ContentFactorySegment
        title="旧标题"
        summary="旧摘要"
        headlineText="华为开始把高阶智驾往更大众价位压"
        commentaryText="真正的看点不是新车，而是高阶能力正在从旗舰往主流价位带下沉。"
        audioSrc="/t022-render-assets/demo/audio.mp3"
        audioDurationInSeconds={18}
        visuals={[
          {type: 'article_image', src: '/t022-render-assets/demo/visual-01.jpg'},
          {type: 'generated_card', src: '/t022-render-assets/demo/visual-02.jpg'},
          {type: 'generated_card', src: '/t022-render-assets/demo/visual-03.jpg'},
        ]}
      />,
    );

    expect(markup).toContain('data-region="headline"');
    expect(markup).toContain('data-region="visuals"');
    expect(markup).toContain('data-region="commentary"');
    expect(markup).toContain('height:30%');
    expect(markup).toContain('height:40%');
    expect(markup).toContain('华为开始把高阶智驾往更大众价位压');
    expect(markup).toContain('今日热评');
    expect(markup).toContain('▍');
    expect(markup).toContain('真');
    expect(markup).toContain('object-fit:contain');
    expect(markup).not.toContain('评论字幕');
    expect(markup).not.toContain('旧摘要');
  });
});
