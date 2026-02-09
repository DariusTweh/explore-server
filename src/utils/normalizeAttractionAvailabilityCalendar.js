export function normalizeAttractionAvailabilityCalendar(rawList) {
  const items = Array.isArray(rawList) ? rawList : [];
  return items
    .map((item) => ({
      date: item?.date || null,
      available: Boolean(item?.available),
    }))
    .filter((item) => !!item.date);
}
