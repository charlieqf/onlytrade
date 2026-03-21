import {Composition} from 'remotion';

import {ContentFactorySegment} from './ContentFactorySegment';
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
  audioSrc: '',
  audioDurationInSeconds: 10,
  visuals: [
    {type: 'headline', src: ''},
    {type: 'market', src: ''},
    {type: 'closing', src: ''},
  ],
};

export const Root = () => {
  return (
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
  );
};
