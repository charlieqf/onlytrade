const normalizeText = (value: string) => value.replace(/\s+/g, ' ').trim();

const ensureSentenceEnding = (value: string) => {
  if (!value) return '';
  return /[。！？!?]$/.test(value) ? value : `${value}。`;
};

export const splitCommentaryText = (commentaryText: string): string[] => {
  const text = normalizeText(commentaryText);
  if (!text) return [];

  const sentences = text
    .split(/(?<=[。！？!?])/)
    .map((part) => normalizeText(part))
    .filter(Boolean);

  if (sentences.length <= 4) {
    return sentences;
  }

  return sentences.slice(0, 4);
};

export const buildDynamicCommentaryText = ({
  topicReason,
  commentaryScript,
}: {
  topicReason?: string;
  commentaryScript?: string;
}): string => {
  const reason = ensureSentenceEnding(normalizeText(topicReason || ''));
  const script = normalizeText(commentaryScript || '');
  if (!reason && !script) return '';

  const scriptSentences = splitCommentaryText(
    script
      .replace(/^(今天我们来聊聊|今天我们看到|今天聊聊|先看这件事)[，,：:]?/, '')
      .replace(/表面上看[^。！？!?]*[。！？!?]?/, '')
  );

  const merged: string[] = [];
  if (reason) {
    merged.push(reason);
  }
  for (const sentence of scriptSentences) {
    if (/^(Claude|OpenAI|苹果|华为|小米|腾讯|阿里|字节|Meta|Google|Amazon|微软).{0,8}(新功能|新品|新动作|这条消息)[。！？!?]?$/.test(sentence)) {
      continue;
    }
    if (!sentence || merged.includes(sentence) || sentence === reason) continue;
    merged.push(sentence);
    if (merged.length >= 3) break;
  }
  return merged.join('');
};

export type CommentaryCue = {
  text: string;
  startFrame: number;
  endFrame: number;
};

export const buildCommentaryTimeline = ({
  commentaryText,
  durationInFrames,
}: {
  commentaryText: string;
  durationInFrames: number;
}): CommentaryCue[] => {
  const lines = splitCommentaryText(commentaryText);
  if (!lines.length) return [];
  const totalFrames = Math.max(durationInFrames, lines.length * 24);
  const totalUnits = lines.reduce((sum, line) => sum + Math.max(line.length, 8), 0);
  let cursor = 0;

  return lines.map((line, index) => {
    const weight = Math.max(line.length, 8);
    const rawDuration = Math.round((weight / totalUnits) * totalFrames);
    const remainingLines = lines.length - index - 1;
    const minRemaining = remainingLines * 24;
    const duration =
      index === lines.length - 1
        ? totalFrames - cursor
        : Math.max(24, Math.min(rawDuration, totalFrames - cursor - minRemaining));

    const cue = {
      text: line,
      startFrame: cursor,
      endFrame: cursor + duration,
    };
    cursor += duration;
    return cue;
  });
};

export const getCommentaryFrameState = ({
  timeline,
  frame,
}: {
  timeline: CommentaryCue[];
  frame: number;
}) => {
  if (!timeline.length) {
    return {previousLines: [] as string[], activeLine: '', upcomingLines: [] as string[]};
  }

  const safeFrame = Math.max(frame, 0);
  const activeIndex = timeline.findIndex(
    (cue) => safeFrame >= cue.startFrame && safeFrame < cue.endFrame
  );
  const resolvedIndex = activeIndex >= 0 ? activeIndex : timeline.length - 1;
  const activeCue = timeline[resolvedIndex];
  const previousLines = timeline.slice(0, resolvedIndex).map((cue) => cue.text);
  const upcomingLines = timeline.slice(resolvedIndex + 1).map((cue) => cue.text);

  const span = Math.max(activeCue.endFrame - activeCue.startFrame, 1);
  const revealSpan = Math.max(18, Math.min(Math.round(span * 0.6), 40));
  const progress = Math.max(
    0,
    Math.min(1, (safeFrame - activeCue.startFrame + 1) / revealSpan)
  );
  const visibleChars = Math.max(1, Math.round(activeCue.text.length * progress));

  return {
    previousLines,
    activeLine: activeCue.text.slice(0, visibleChars),
    upcomingLines,
  };
};
