import {AbsoluteFill, Audio, Img, Sequence, interpolate, useCurrentFrame, useVideoConfig} from 'remotion';

import {calculateSegmentMetadata, type SegmentProps, type SegmentVisual} from './calculateMetadata';
import {resolveAssetSrc} from './resolveAssetSrc';

const panelStyle = {
  position: 'absolute',
  left: 72,
  right: 72,
  padding: '28px 32px',
  borderRadius: 32,
  background: 'rgba(7, 15, 24, 0.72)',
  color: '#f8fafc',
  backdropFilter: 'blur(18px)',
  boxShadow: '0 24px 80px rgba(15, 23, 42, 0.35)',
} satisfies React.CSSProperties;

const fallbackVisual = (index: number): SegmentVisual => ({
  type: `visual-${index + 1}`,
  src: '',
});

const VisualCard = ({visual, index}: {visual: SegmentVisual; index: number}) => {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [0, 12], [0.6, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  return (
    <AbsoluteFill
      style={{
        opacity,
        padding: 160,
        justifyContent: 'center',
      }}
    >
      <div
        style={{
          position: 'relative',
          width: '100%',
          height: '100%',
          overflow: 'hidden',
          borderRadius: 48,
          background: 'linear-gradient(135deg, rgba(30, 41, 59, 0.95), rgba(15, 23, 42, 0.82))',
          border: '1px solid rgba(148, 163, 184, 0.2)',
        }}
      >
        {visual.src ? (
          <Img
            src={resolveAssetSrc(visual.src)}
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover',
            }}
          />
        ) : null}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: visual.src
              ? 'linear-gradient(180deg, rgba(15, 23, 42, 0.08), rgba(15, 23, 42, 0.5))'
              : 'linear-gradient(135deg, rgba(14, 165, 233, 0.24), rgba(249, 115, 22, 0.24))',
          }}
        />
        <div
          style={{
            position: 'absolute',
            left: 32,
            bottom: 32,
            padding: '14px 18px',
            borderRadius: 999,
            background: 'rgba(15, 23, 42, 0.78)',
            color: '#e2e8f0',
            fontSize: 28,
            fontWeight: 600,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
          }}
        >
          {visual.type || `Visual ${index + 1}`}
        </div>
      </div>
    </AbsoluteFill>
  );
};

export const ContentFactorySegment = ({
  title,
  summary,
  audioSrc,
  audioDurationInSeconds,
  visuals,
}: SegmentProps) => {
  const {fps} = useVideoConfig();
  const metadata = calculateSegmentMetadata({audioDurationInSeconds, fps});
  const visualSlots = [0, 1, 2].map((index) => visuals[index] ?? fallbackVisual(index));

  return (
    <AbsoluteFill
      style={{
        background: 'radial-gradient(circle at top, #0f172a 0%, #020617 58%, #000814 100%)',
        fontFamily: '"Segoe UI", "Helvetica Neue", sans-serif',
      }}
    >
      {audioSrc ? <Audio src={resolveAssetSrc(audioSrc)} /> : null}
      {metadata.sceneWindows.map((scene, index) => (
        <Sequence key={`${visualSlots[index].type}-${index}`} from={scene.from} durationInFrames={scene.durationInFrames}>
          <VisualCard visual={visualSlots[index]} index={index} />
        </Sequence>
      ))}
      <div
        style={{
          ...panelStyle,
          top: 72,
        }}
      >
        <div
          style={{
            fontSize: 78,
            fontWeight: 700,
            lineHeight: 1.08,
          }}
        >
          {title}
        </div>
      </div>
      <div
        style={{
          ...panelStyle,
          bottom: 72,
        }}
      >
        <div
          style={{
            fontSize: 42,
            lineHeight: 1.35,
            color: '#e2e8f0',
          }}
        >
          {summary}
        </div>
      </div>
    </AbsoluteFill>
  );
};
