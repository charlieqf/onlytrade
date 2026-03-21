import type {CalculateMetadataFunction} from 'remotion';

export const SEGMENT_FPS = 30;
export const SEGMENT_WIDTH = 1080;
export const SEGMENT_HEIGHT = 1920;

export type SegmentVisual = {
  type: string;
  src: string;
};

export type SegmentProps = {
  title: string;
  summary: string;
  audioSrc: string;
  audioDurationInSeconds: number;
  visuals: SegmentVisual[];
};

export type SceneWindow = {
  from: number;
  durationInFrames: number;
};

export type SegmentMetadata = {
  width: number;
  height: number;
  durationInFrames: number;
  sceneDurationsInFrames: [number, number, number];
  sceneWindows: [SceneWindow, SceneWindow, SceneWindow];
};

export const splitSceneDurations = (
  durationInFrames: number,
): [number, number, number] => {
  const safeDuration = Math.max(1, durationInFrames);
  const first = Math.floor(safeDuration * 0.34);
  const second = Math.floor(safeDuration * 0.33);
  const third = safeDuration - first - second;

  return [first, second, third];
};

export const calculateSegmentMetadata = ({
  audioDurationInSeconds,
  fps = SEGMENT_FPS,
}: {
  audioDurationInSeconds: number;
  fps?: number;
}): SegmentMetadata => {
  const durationInFrames = Math.max(1, Math.round(audioDurationInSeconds * fps));
  const sceneDurationsInFrames = splitSceneDurations(durationInFrames);
  const sceneWindows: [SceneWindow, SceneWindow, SceneWindow] = [
    {from: 0, durationInFrames: sceneDurationsInFrames[0]},
    {
      from: sceneDurationsInFrames[0],
      durationInFrames: sceneDurationsInFrames[1],
    },
    {
      from: sceneDurationsInFrames[0] + sceneDurationsInFrames[1],
      durationInFrames: sceneDurationsInFrames[2],
    },
  ];

  return {
    width: SEGMENT_WIDTH,
    height: SEGMENT_HEIGHT,
    durationInFrames,
    sceneDurationsInFrames,
    sceneWindows,
  };
};

export const calculateMetadata: CalculateMetadataFunction<SegmentProps> = ({
  props,
}) => {
  const metadata = calculateSegmentMetadata({
    audioDurationInSeconds: props.audioDurationInSeconds,
    fps: SEGMENT_FPS,
  });

  return {
    durationInFrames: metadata.durationInFrames,
    width: metadata.width,
    height: metadata.height,
  };
};
