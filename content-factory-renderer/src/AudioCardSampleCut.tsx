import {AbsoluteFill, Audio, Img, Sequence, interpolate, useCurrentFrame, useVideoConfig} from 'remotion';

import {resolveAssetSrc} from './resolveAssetSrc';
import {clampCutaways, findActiveSubtitleCue, type Cutaway, type SubtitleCue} from './tldrSampleCutPlan';

export type AudioCardSampleCutProps = {
  audioSrc: string;
  durationInSeconds: number;
  headline: string;
  sourceLabel: string;
  subtitleCues: SubtitleCue[];
  cutaways: Cutaway[];
};

export const calculateAudioCardSampleCutMetadata = ({
  durationInSeconds,
  fps,
}: {
  durationInSeconds: number;
  fps: number;
}) => {
  return {
    width: 1080,
    height: 1920,
    durationInFrames: Math.max(1, Math.round(durationInSeconds * fps)),
  };
};

const ImageCutawayOverlay = ({cutaway}: {cutaway: Cutaway}) => {
  const frame = useCurrentFrame();
  const scale = interpolate(frame, [0, 40], [1.04, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  return (
    <AbsoluteFill style={{opacity: 1}}>
      <Img
        src={resolveAssetSrc(cutaway.assetSrc)}
        style={{
          width: '100%',
          height: '100%',
          objectFit: cutaway.fitMode ?? 'contain',
          transform: `scale(${scale})`,
        }}
      />
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background:
            'linear-gradient(180deg, rgba(1, 5, 11, 0.08), rgba(1, 5, 11, 0.12) 45%, rgba(1, 5, 11, 0.54) 100%)',
        }}
      />
    </AbsoluteFill>
  );
};

export const AudioCardSampleCut = ({
  audioSrc,
  durationInSeconds,
  headline,
  sourceLabel,
  subtitleCues,
  cutaways,
}: AudioCardSampleCutProps) => {
  const frame = useCurrentFrame();
  const {fps, durationInFrames} = useVideoConfig();
  const activeCue = findActiveSubtitleCue({cues: subtitleCues, frame, fps});
  const cutawayWindows = clampCutaways({cutaways, fps, durationInFrames});

  return (
    <AbsoluteFill
      style={{
        background: 'radial-gradient(circle at top, #18212f 0%, #05070c 55%, #02040a 100%)',
        color: '#f8fafc',
        fontFamily: '"Segoe UI", "Helvetica Neue", Arial, sans-serif',
      }}
    >
      <Audio src={resolveAssetSrc(audioSrc)} />

      <div
        style={{
          position: 'absolute',
          inset: 0,
          background:
            'linear-gradient(180deg, rgba(2, 6, 23, 0.02) 0%, rgba(2, 6, 23, 0.06) 32%, rgba(2, 6, 23, 0.18) 58%, rgba(2, 6, 23, 0.6) 100%)',
        }}
      />

      <div
        style={{
          position: 'absolute',
          top: 88,
          left: 72,
          right: 72,
          display: 'flex',
          flexDirection: 'column',
          gap: 18,
        }}
      >
        <div
          style={{
            maxWidth: 880,
            fontSize: 82,
            lineHeight: 0.98,
            fontWeight: 900,
            letterSpacing: '-0.06em',
            color: '#fff7ef',
            textShadow: '0 18px 38px rgba(0, 0, 0, 0.36), 0 2px 0 rgba(255, 111, 97, 0.18)',
            whiteSpace: 'pre-wrap',
          }}
        >
          {headline}
        </div>
        <div
          style={{
            alignSelf: 'flex-start',
            padding: '10px 18px',
            borderRadius: 999,
            background: 'rgba(255, 244, 237, 0.88)',
            border: '1px solid rgba(255,255,255,0.28)',
            fontSize: 24,
            fontWeight: 700,
            color: '#ff5b6e',
            boxShadow: '0 10px 24px rgba(0,0,0,0.14)',
          }}
        >
          {sourceLabel}
        </div>
      </div>

      {cutawayWindows.map((cutaway) => (
        <Sequence key={`${cutaway.assetSrc}-${cutaway.from}`} from={cutaway.from} durationInFrames={cutaway.durationInFrames}>
          <ImageCutawayOverlay cutaway={cutaway} />
        </Sequence>
      ))}

      {activeCue ? (
        <div
          style={{
            position: 'absolute',
            left: 32,
            right: 32,
            bottom: 188,
            display: 'flex',
            justifyContent: 'center',
          }}
        >
          <div
            style={{
              maxWidth: 986,
              padding: '20px 26px 22px 34px',
              borderRadius: 34,
              background: 'rgba(255, 248, 240, 0.97)',
              border: '2px solid rgba(255, 123, 99, 0.18)',
              boxShadow: '0 22px 54px rgba(0,0,0,0.18)',
              textAlign: 'center',
              position: 'relative',
            }}
          >
            <div
              style={{
                position: 'absolute',
                left: 14,
                top: 16,
                bottom: 16,
                width: 8,
                borderRadius: 999,
                background: 'linear-gradient(180deg, #ff5b6e 0%, #ff9a3c 100%)',
              }}
            />
            <div
              style={{
                fontSize: 52,
                lineHeight: 1.16,
                fontWeight: 900,
                letterSpacing: '-0.03em',
                color: '#1d1d24',
                textShadow: '0 1px 0 rgba(255,255,255,0.24)',
              }}
            >
              {activeCue.text}
            </div>
          </div>
        </div>
      ) : null}
    </AbsoluteFill>
  );
};
