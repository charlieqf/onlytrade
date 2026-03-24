import {AbsoluteFill, Audio, Img, Sequence, interpolate, useCurrentFrame, useVideoConfig} from 'remotion';

import {calculateSegmentMetadata, type SegmentProps, type SegmentVisual} from './calculateMetadata';
import {getHeadlineTypography, getVisualPresentation} from './layoutDecisions';
import {resolveAssetSrc} from './resolveAssetSrc';

const REGION_PADDING_X = 72;
const TITLE_REGION_HEIGHT = '30%';
const VISUAL_REGION_HEIGHT = '40%';
const COMMENTARY_REGION_HEIGHT = '30%';
const SOCIAL_ACCENT = '#f97316';
const SOCIAL_PINK = '#fb7185';

const fallbackVisual = (index: number): SegmentVisual => ({
  type: `visual-${index + 1}`,
  src: '',
});

const VisualCard = ({visual, index}: {visual: SegmentVisual; index: number}) => {
  const frame = useCurrentFrame();
  const visualPresentation = getVisualPresentation(visual.type);
  const opacity = interpolate(frame, [0, 10], [0.72, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const scale = interpolate(frame, [0, 90], [1, 1.06], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const translateY = interpolate(frame, [0, 90], [0, -26], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  return (
    <AbsoluteFill
      style={{
        opacity,
        justifyContent: 'center',
      }}
    >
      <div
        style={{
          position: 'relative',
          width: '100%',
          height: '100%',
          overflow: 'hidden',
          background: 'linear-gradient(135deg, rgba(15, 23, 42, 0.92), rgba(2, 6, 23, 0.96))',
        }}
      >
        {visual.src ? (
          <Img
            src={resolveAssetSrc(visual.src)}
            style={{
              width: '100%',
              height: '100%',
              objectFit: visualPresentation.fit,
              boxSizing: 'border-box',
              padding: visualPresentation.inset,
              transform: `translate3d(0, ${translateY}px, 0) scale(${scale})`,
            }}
          />
        ) : null}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: visual.src
              ? 'linear-gradient(180deg, rgba(15, 23, 42, 0.08), rgba(15, 23, 42, 0.34) 50%, rgba(15, 23, 42, 0.54))'
              : 'linear-gradient(135deg, rgba(14, 165, 233, 0.24), rgba(249, 115, 22, 0.24))',
          }}
        />
      </div>
    </AbsoluteFill>
  );
};

export const ContentFactorySegment = ({
  title,
  summary,
  headlineText,
  commentaryText,
  audioSrc,
  audioDurationInSeconds,
  visuals,
}: SegmentProps) => {
  const {fps} = useVideoConfig();
  const metadata = calculateSegmentMetadata({audioDurationInSeconds, fps});
  const visualSlots = [0, 1, 2].map((index) => visuals[index] ?? fallbackVisual(index));
  const displayHeadline = (headlineText || title || '').trim();
  const displayCommentary = (commentaryText || summary || '').trim();
  const headlineTypography = getHeadlineTypography(displayHeadline);

  return (
    <AbsoluteFill
      style={{
        background: 'linear-gradient(180deg, #08111f 0%, #020617 100%)',
        color: '#f8fafc',
        fontFamily: '"Segoe UI", "Helvetica Neue", sans-serif',
      }}
    >
      {audioSrc ? <Audio src={resolveAssetSrc(audioSrc)} /> : null}
      <div
        data-region="headline"
        style={{
          position: 'absolute',
          inset: 0,
          height: TITLE_REGION_HEIGHT,
          padding: `74px ${REGION_PADDING_X}px 48px`,
          background:
            'linear-gradient(180deg, rgba(7, 12, 26, 0.98) 0%, rgba(11, 18, 34, 0.97) 64%, rgba(10, 16, 30, 0.82) 100%)',
          display: 'flex',
          alignItems: 'flex-end',
        }}
      >
        <div
          style={{
            width: '100%',
            display: 'flex',
            flexDirection: 'column',
            gap: 26,
          }}
        >
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 14,
              alignSelf: 'flex-start',
              padding: '14px 24px',
              borderRadius: 999,
              background: 'rgba(255, 255, 255, 0.08)',
              boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.08)',
            }}
          >
            <span
              style={{
                width: 14,
                height: 14,
                borderRadius: 999,
                background: `linear-gradient(135deg, ${SOCIAL_PINK}, ${SOCIAL_ACCENT})`,
                boxShadow: `0 0 24px ${SOCIAL_PINK}`,
              }}
            />
            <span
              style={{
                fontSize: 28,
                fontWeight: 800,
                letterSpacing: '0.08em',
                color: '#fde68a',
              }}
            >
              今日热评
            </span>
          </div>

          <div
            style={{
              width: '100%',
              fontSize: headlineTypography.fontSize,
              fontWeight: 900,
              lineHeight: headlineTypography.lineHeight,
              letterSpacing: '-0.075em',
              textShadow: '0 22px 54px rgba(0, 0, 0, 0.4)',
              display: '-webkit-box',
              WebkitLineClamp: headlineTypography.lineClamp,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
            }}
          >
            {displayHeadline}
          </div>
        </div>
      </div>

      <div
        data-region="visuals"
        style={{
          position: 'absolute',
          top: TITLE_REGION_HEIGHT,
          left: 0,
          right: 0,
          height: VISUAL_REGION_HEIGHT,
          overflow: 'hidden',
          background: '#040b16',
          boxShadow: '0 24px 72px rgba(0, 0, 0, 0.28)',
        }}
      >
        {metadata.sceneWindows.map((scene, index) => (
          <Sequence key={`${visualSlots[index].type}-${index}`} from={scene.from} durationInFrames={scene.durationInFrames}>
            <VisualCard visual={visualSlots[index]} index={index} />
          </Sequence>
        ))}
        <div
          style={{
            position: 'absolute',
            left: '50%',
            bottom: 22,
            transform: 'translateX(-50%)',
            display: 'flex',
            gap: 10,
            padding: '10px 16px',
            borderRadius: 999,
            background: 'rgba(2, 6, 23, 0.38)',
            backdropFilter: 'blur(18px)',
          }}
        >
          {visualSlots.map((visual, index) => (
            <span
              key={`${visual.type}-dot-${index}`}
              style={{
                width: index === 0 ? 24 : 10,
                height: 10,
                borderRadius: 999,
                background:
                  index === 0
                    ? `linear-gradient(135deg, ${SOCIAL_PINK}, ${SOCIAL_ACCENT})`
                    : 'rgba(255,255,255,0.55)',
              }}
            />
          ))}
        </div>
      </div>

      <div
        data-region="commentary"
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          height: COMMENTARY_REGION_HEIGHT,
          padding: `38px ${REGION_PADDING_X}px 74px`,
          background:
            'linear-gradient(180deg, rgba(8, 13, 26, 0.68) 0%, rgba(7, 12, 24, 0.94) 24%, rgba(3, 6, 13, 1) 100%)',
          display: 'flex',
          alignItems: 'flex-start',
        }}
      >
        <div
          style={{
            width: '100%',
            padding: '28px 30px 34px',
            borderRadius: 34,
            background: 'linear-gradient(180deg, rgba(255,255,255,0.1), rgba(255,255,255,0.06))',
            boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.08), 0 24px 60px rgba(0,0,0,0.22)',
            backdropFilter: 'blur(18px)',
            display: 'flex',
            flexDirection: 'column',
            gap: 18,
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <span
              style={{
                fontSize: 28,
                fontWeight: 800,
                letterSpacing: '0.08em',
                color: '#fdba74',
              }}
            >
              一句话点评
            </span>
            <span
              style={{
                fontSize: 72,
                lineHeight: 1,
                fontWeight: 900,
                color: 'rgba(255,255,255,0.24)',
                transform: 'translateY(10px)',
              }}
            >
              “
            </span>
          </div>

          <div
            style={{
              fontSize: 58,
              lineHeight: 1.18,
              fontWeight: 750,
              color: '#f8fbff',
              letterSpacing: '-0.045em',
              display: '-webkit-box',
              WebkitLineClamp: 3,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
            }}
          >
            {displayCommentary}
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
};
