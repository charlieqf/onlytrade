import {Composition} from 'remotion';

import {
  AudioCardSampleCut,
  calculateAudioCardSampleCutMetadata,
  type AudioCardSampleCutProps,
} from './AudioCardSampleCut';

const defaultProps: AudioCardSampleCutProps = {
  audioSrc: 'tldr-sample/demo/audio.mp3',
  durationInSeconds: 12,
  headline: 'Audio Card Demo',
  sourceLabel: 'Local Audio',
  subtitleCues: [
    {startSec: 0, endSec: 3, text: '第一句字幕'},
    {startSec: 3, endSec: 6, text: '第二句字幕'},
  ],
  cutaways: [
    {startSec: 0.8, endSec: 6, assetSrc: 'tldr-sample/demo/card-001.jpg', label: '卡片', fitMode: 'contain', motion: 'none'},
  ],
};

export const AudioCardRoot = () => {
  return (
    <Composition
      id="audio-card-sample-cut"
      component={AudioCardSampleCut}
      defaultProps={defaultProps}
      fps={30}
      width={1080}
      height={1920}
      durationInFrames={30 * 30}
      calculateMetadata={({props}) =>
        calculateAudioCardSampleCutMetadata({durationInSeconds: props.durationInSeconds, fps: 30})
      }
    />
  );
};
