function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function pickMinPrice(items) {
  let best = null;
  for (const item of items || []) {
    const price = item?.price?.chargeAmount ?? item?.price?.publicAmount;
    const amount = toNumber(price);
    if (amount === null) continue;
    if (!best || amount < best.amount) {
      best = { amount, currency: item?.price?.currency || null };
    }
  }
  return best;
}

export function normalizeAttractionAvailability(rawList) {
  const slots = Array.isArray(rawList) ? rawList : [];

  return slots.map((slot) => {
    const offers = Array.isArray(slot?.timeSlotOffers) ? slot.timeSlotOffers : [];
    const items = offers.flatMap((offer) => (Array.isArray(offer?.items) ? offer.items : []));
    const minPrice = pickMinPrice(items);

    return {
      timeSlotId: slot?.timeSlotId || null,
      start: slot?.start || null,
      fullDay: Boolean(slot?.fullDay),
      minPrice,
      offers: offers.map((offer) => ({
        id: offer?.id || null,
        label: offer?.label || null,
        languageOptions: Array.isArray(offer?.languageOptions) ? offer.languageOptions : [],
        items: Array.isArray(offer?.items)
          ? offer.items.map((item) => ({
              id: item?.id || null,
              type: item?.type || null,
              label: item?.label || null,
              maxPerReservation: item?.maxPerReservation ?? null,
              minPerReservation: item?.minPerReservation ?? null,
              ticketsAvailable: item?.ticketsAvailable ?? null,
              price: {
                amount: toNumber(item?.price?.chargeAmount ?? item?.price?.publicAmount),
                currency: item?.price?.currency || null,
              },
              cancellation: {
                hasFreeCancellation: Boolean(item?.cancellationPolicy?.hasFreeCancellation),
                isStillRefundable: Boolean(item?.cancellationPolicy?.isStillRefundable),
              },
            }))
          : [],
      })),
    };
  });
}
