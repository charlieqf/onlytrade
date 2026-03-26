export type SubtitleCue = {
  startSec: number;
  endSec: number;
  text: string;
};

export type Cutaway = {
  startSec: number;
  endSec: number;
  assetSrc: string;
  label?: string;
};

export const secondsToFrames = (seconds: number, fps: number): number => {
  return Math.max(0, Math.round(Math.max(0, seconds) * fps));
};

export const clampCutaways = ({
  cutaways,
  fps,
  durationInFrames,
}: {
  cutaways: Cutaway[];
  fps: number;
  durationInFrames: number;
}): Array<Cutaway & {from: number; durationInFrames: number}> => {
  return cutaways
    .map((cutaway) => {
      const from = secondsToFrames(cutaway.startSec, fps);
      const to = Math.min(durationInFrames, secondsToFrames(cutaway.endSec, fps));
      return {
        ...cutaway,
        from,
        durationInFrames: Math.max(0, to - from),
      };
    })
    .filter((cutaway) => cutaway.durationInFrames > 0)
    .sort((a, b) => a.from - b.from);
};

export const findActiveSubtitleCue = ({
  cues,
  frame,
  fps,
}: {
  cues: SubtitleCue[];
  frame: number;
  fps: number;
}): SubtitleCue | null => {
  const currentSec = frame / fps;
  return cues.find((cue) => currentSec >= cue.startSec && currentSec < cue.endSec) ?? null;
};
