const estimateHeadlineUnits = (headline: string) => {
  let units = 0;
  for (const char of Array.from((headline || '').trim())) {
    if (/\s/.test(char)) {
      units += 0.2;
      continue;
    }
    if (/[A-Za-z0-9]/.test(char)) {
      units += 0.85;
      continue;
    }
    if (/[,.:;!?，。：；！？、“”‘’()（）【】\-]/.test(char)) {
      units += 0.55;
      continue;
    }
    units += 1;
  }
  return units;
};

export const getHeadlineTypography = (headline: string) => {
  const units = estimateHeadlineUnits(headline);

  if (units >= 28) {
    return {fontSize: 72, lineHeight: 1.02, lineClamp: 3};
  }

  if (units >= 18) {
    return {fontSize: 82, lineHeight: 1, lineClamp: 3};
  }

  return {fontSize: 100, lineHeight: 0.98, lineClamp: 2};
};

export const getVisualPresentation = (visualType: string) => {
  if (visualType === 'article_image') {
    return {fit: 'cover' as const, inset: 0};
  }

  return {fit: 'contain' as const, inset: 0};
};
