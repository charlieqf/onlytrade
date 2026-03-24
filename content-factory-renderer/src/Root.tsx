import {Composition} from 'remotion';

import {ContentFactorySegment} from './ContentFactorySegment';
import {TldrSampleCut, calculateTldrSampleCutMetadata, type TldrSampleCutProps} from './TldrSampleCut';
import {
  calculateMetadata,
  SEGMENT_FPS,
  SEGMENT_HEIGHT,
  SEGMENT_WIDTH,
  type SegmentProps,
} from './calculateMetadata';

const defaultProps: SegmentProps = {
  title: 'China Big Tech Momentum Check',
  summary: 'A short one-topic segment with three visuals and a full-length audio bed.',
  headlineText: 'China Big Tech Momentum Check',
  commentaryText: 'The real signal is how quickly platform and device narratives are starting to converge.',
  audioSrc: '',
  audioDurationInSeconds: 10,
  visuals: [
    {type: 'headline', src: ''},
    {type: 'market', src: ''},
    {type: 'closing', src: ''},
  ],
};

const tldrSampleDefaultProps: TldrSampleCutProps = {
  videoSrc: 'tldr-sample/openai-researcher-v2/aroll-video.mp4',
  durationInSeconds: 29.6,
  headline: 'OpenAI全力押注|AI研究员',
  sourceLabel: 'MIT Technology Review · Jakub Pachocki 访谈',
  subtitleCues: [
    {startSec: 0.0, endSec: 2.5, text: '今天说一条 OpenAI 的新闻。'},
    {startSec: 2.5, endSec: 4.8, text: '它的首席科学家在接受 MIT 访谈时提到，'},
    {startSec: 4.8, endSec: 8.0, text: '要把“全自动 AI 研究员”作为未来几年的核心方向。'},
    {startSec: 8.0, endSec: 9.8, text: '他甚至直接给了时间线：'},
    {startSec: 9.8, endSec: 11.4, text: '今年 9 月先推一个 AI 实习生，'},
    {startSec: 11.4, endSec: 14.5, text: '后面到 2028 年，再推多智能体研究系统。'},
    {startSec: 14.5, endSec: 16.0, text: '这个事情真正的信号是，'},
    {startSec: 16.0, endSec: 18.0, text: 'OpenAI 已经不满足于只做模型本身了。'},
    {startSec: 18.0, endSec: 20.8, text: '它开始往“直接做研究任务”这一步走。'},
    {startSec: 20.8, endSec: 22.4, text: '如果这条线真的跑通，'},
    {startSec: 22.4, endSec: 24.5, text: '被改写的就不是聊天产品和 agent，'},
    {startSec: 24.5, endSec: 26.9, text: '而是企业里的研究、分析和情报工作流。'},
    {startSec: 26.9, endSec: 29.6, text: '这会很大程度上重写知识生产的效率边界。'},
  ],
  cutaways: [
    {startSec: 2.5, endSec: 8.0, assetSrc: 'tldr-sample/openai-researcher-v2/source-card.jpg', label: '真实来源'},
    {startSec: 8.0, endSec: 14.5, assetSrc: 'tldr-sample/openai-researcher-v2/timeline-card.jpg', label: '时间线'},
    {startSec: 20.8, endSec: 26.9, assetSrc: 'tldr-sample/openai-researcher-v2/impact-card.jpg', label: '行业影响'},
  ],
};

export const Root = () => {
  return (
    <>
      <Composition
        id="content-factory-segment"
        component={ContentFactorySegment}
        defaultProps={defaultProps}
        fps={SEGMENT_FPS}
        width={SEGMENT_WIDTH}
        height={SEGMENT_HEIGHT}
        durationInFrames={SEGMENT_FPS * 10}
        calculateMetadata={calculateMetadata}
      />
      <Composition
        id="tldr-sample-cut"
        component={TldrSampleCut}
        defaultProps={tldrSampleDefaultProps}
        fps={30}
        width={1080}
        height={1920}
        durationInFrames={30 * 30}
        calculateMetadata={({props}) => calculateTldrSampleCutMetadata({durationInSeconds: props.durationInSeconds, fps: 30})}
      />
    </>
  );
};
