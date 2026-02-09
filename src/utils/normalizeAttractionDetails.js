function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function splitLines(text) {
  return String(text || "")
    .split(/\n{1,2}/g)
    .map((line) => line.trim())
    .filter(Boolean);
}

function humanizeFlag(flag) {
  const raw = String(flag || "");
  if (!raw) return "";
  return raw
    .replace(/^aiBadges/, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .trim();
}

export function normalizeAttractionDetails(raw, { coords = null } = {}) {
  const photos = Array.isArray(raw?.photos) ? raw.photos : [];
  const orderedPhotos = [...photos].sort((a, b) => Number(Boolean(b?.isPrimary)) - Number(Boolean(a?.isPrimary)));

  const reviews = Array.isArray(raw?.reviews?.reviews) ? raw.reviews.reviews : [];
  const reviewsPreview = reviews.slice(0, 3).map((review) => ({
    id: String(review?.id || ""),
    name: review?.user?.name || null,
    cc1: review?.user?.cc1 || null,
    numericRating: toNumber(review?.numericRating),
    content: review?.content || null,
    epochMs: toNumber(review?.epochMs),
  }));

  const labels = Array.isArray(raw?.labels) ? raw.labels : [];
  const flags = Array.isArray(raw?.flags) ? raw.flags : [];
  const quickTags = [];
  if (raw?.cancellationPolicy?.hasFreeCancellation) quickTags.push("Free cancellation");
  for (const label of labels) {
    const text = String(label?.text || "").trim();
    if (text && !quickTags.includes(text)) quickTags.push(text);
  }
  for (const flag of flags) {
    if (!flag?.value) continue;
    const text = humanizeFlag(flag?.flag);
    if (text && !quickTags.includes(text)) quickTags.push(text);
  }

  const guideLanguages = Array.isArray(raw?.guideSupportedLanguages) ? raw.guideSupportedLanguages : [];
  const audioLanguages = Array.isArray(raw?.audioSupportedLanguages) ? raw.audioSupportedLanguages : [];

  return {
    id: String(raw?.id || raw?.slug || ""),
    slug: raw?.slug || null,
    name: raw?.name || "Experience",
    photos: orderedPhotos.map((photo) => ({
      small: photo?.small || null,
      medium: photo?.medium || null,
      isPrimary: Boolean(photo?.isPrimary),
    })),
    price: {
      amount:
        toNumber(raw?.representativePrice?.chargeAmount) ??
        toNumber(raw?.representativePrice?.publicAmount),
      currency: raw?.representativePrice?.currency || null,
    },
    rating: {
      avg: toNumber(raw?.reviewsStats?.combinedNumericStats?.average),
      count:
        toNumber(raw?.reviewsStats?.combinedNumericStats?.total) ??
        toNumber(raw?.reviews?.total),
    },
    freeCancellation: Boolean(raw?.cancellationPolicy?.hasFreeCancellation),
    operator: raw?.operatedBy || null,
    description: raw?.description || null,
    included: Array.isArray(raw?.whatsIncluded) ? raw.whatsIncluded.filter(Boolean) : [],
    notIncluded: Array.isArray(raw?.notIncluded) ? raw.notIncluded.filter(Boolean) : [],
    additionalInfoLines: splitLines(raw?.additionalInfo),
    languages: {
      guide: guideLanguages.filter(Boolean),
      audio: audioLanguages.filter(Boolean),
    },
    quickTags: quickTags.slice(0, 3),
    reviewsPreview,
    reviewsTotal: toNumber(raw?.reviews?.total),
    coords: coords
      ? {
          lat: toNumber(coords?.lat),
          lng: toNumber(coords?.lng),
          source: coords?.source || null,
          addressLabel: coords?.addressLabel || null,
        }
      : null,
    mapPreview: {
      title: raw?.name || "Experience",
      photo: raw?.primaryPhoto?.small || orderedPhotos?.[0]?.small || null,
      price: {
        amount:
          toNumber(raw?.representativePrice?.chargeAmount) ??
          toNumber(raw?.representativePrice?.publicAmount),
        currency: raw?.representativePrice?.currency || null,
      },
    },
    rawAddresses: raw?.addresses || null,
  };
}
