const DEFAULT_WINDOWS = {
  morning: { start: "09:00", end: "12:00" },
  lunch: { start: "12:30", end: "13:45" },
  afternoon: { start: "14:30", end: "17:30" },
  dinner: { start: "18:30", end: "20:00" },
  evening: { start: "20:15", end: "22:30" },
};

export const SCHEDULE_DEFAULTS = {
  dayStartTime: "09:00",
  dayEndTime: "22:30",
  checkInStart: "15:00",
  checkInEnd: "15:30",
  checkOutStart: "11:00",
  checkOutEnd: "11:30",
  bufferMin: 30,
  durations: {
    attraction: 120,
    place: 90,
    restaurant_lunch: 75,
    restaurant_dinner: 90,
    restaurant: 90,
    hotel: 30,
    transit: 30,
    flight: 120,
  },
};

function pad(value) {
  return String(value).padStart(2, "0");
}

function minutesToTime(totalMin) {
  const normalized = Math.max(0, Math.round(totalMin));
  const hh = Math.floor(normalized / 60);
  const mm = normalized % 60;
  return `${pad(hh)}:${pad(mm)}`;
}

function timeToMinutes(value, fallback = null) {
  if (!value) return fallback;
  const raw = String(value);
  const timePart = raw.includes("T") ? raw.split("T")[1] || "" : raw;
  const [hh, mm] = timePart.split(":");
  const hours = Number(hh);
  const mins = Number(mm);
  if (!Number.isFinite(hours) || !Number.isFinite(mins)) return fallback;
  return hours * 60 + mins;
}

function buildIso(date, timeValue) {
  const time = String(timeValue || "00:00");
  return `${date}T${time.length === 5 ? `${time}:00` : time}`;
}

function normalizeWindow(name) {
  if (name && DEFAULT_WINDOWS[name]) return name;
  return "afternoon";
}

function defaultDurationFor(item) {
  if (Number.isFinite(Number(item?.durationMin)) && Number(item.durationMin) > 0) {
    return Number(item.durationMin);
  }
  if (item?.type === "restaurant") {
    if (item?.timeWindow === "lunch") return SCHEDULE_DEFAULTS.durations.restaurant_lunch;
    if (item?.timeWindow === "dinner") return SCHEDULE_DEFAULTS.durations.restaurant_dinner;
    return SCHEDULE_DEFAULTS.durations.restaurant;
  }
  return SCHEDULE_DEFAULTS.durations[item?.type] || 90;
}

function normalizeInterval(item, date) {
  const startMin = timeToMinutes(item?.startTime, null);
  const endMin = timeToMinutes(item?.endTime, null);
  return {
    ...item,
    date,
    durationMin: defaultDurationFor(item),
    startMin,
    endMin,
  };
}

function hasConflict(startMin, endMin, scheduled, bufferMin) {
  return scheduled.some((item) => {
    if (item.startMin === null || item.endMin === null) return false;
    const blockedStart = item.startMin - bufferMin;
    const blockedEnd = item.endMin + bufferMin;
    return startMin < blockedEnd && endMin > blockedStart;
  });
}

function pushPastConflicts(startMin, endMin, scheduled, bufferMin) {
  let nextStart = startMin;
  let nextEnd = endMin;
  let changed = true;

  while (changed) {
    changed = false;
    const sorted = [...scheduled].sort((a, b) => (a.startMin ?? 0) - (b.startMin ?? 0));
    for (const item of sorted) {
      if (item.startMin === null || item.endMin === null) continue;
      const blockedStart = item.startMin - bufferMin;
      const blockedEnd = item.endMin + bufferMin;
      if (nextStart < blockedEnd && nextEnd > blockedStart) {
        nextStart = item.endMin + bufferMin;
        nextEnd = nextStart + (endMin - startMin);
        changed = true;
      }
    }
  }

  return { startMin: nextStart, endMin: nextEnd };
}

export function scheduleDay({
  date,
  items = [],
  dayStartTime = SCHEDULE_DEFAULTS.dayStartTime,
  dayEndTime = SCHEDULE_DEFAULTS.dayEndTime,
  maxActivities = 3,
}) {
  const dayStartMin = timeToMinutes(dayStartTime, timeToMinutes(SCHEDULE_DEFAULTS.dayStartTime, 540));
  const dayEndMin = timeToMinutes(dayEndTime, timeToMinutes(SCHEDULE_DEFAULTS.dayEndTime, 1350));
  const bufferMin = SCHEDULE_DEFAULTS.bufferMin;

  const scheduled = [];
  let activityCount = 0;

  for (const rawItem of items) {
    const item = normalizeInterval(rawItem, date);
    if (item.startMin !== null && item.endMin !== null) {
      scheduled.push(item);
      if (item.type === "attraction" || item.kind === "activity") {
        activityCount += 1;
      }
    }
  }

  const candidates = items
    .map((item) => normalizeInterval(item, date))
    .filter((item) => item.startMin === null || item.endMin === null)
    .sort((a, b) => {
      const order = ["morning", "lunch", "afternoon", "dinner", "evening"];
      return order.indexOf(normalizeWindow(a.timeWindow)) - order.indexOf(normalizeWindow(b.timeWindow));
    });

  for (const item of candidates) {
    if ((item.type === "attraction" || item.kind === "activity") && activityCount >= maxActivities) {
      continue;
    }

    const windowName = normalizeWindow(item.timeWindow);
    const window = DEFAULT_WINDOWS[windowName];
    const durationMin = item.durationMin;
    const windowStart = Math.max(dayStartMin, timeToMinutes(window.start, dayStartMin));
    const windowEnd = Math.min(dayEndMin, timeToMinutes(window.end, dayEndMin));

    let startMin = windowStart;
    let endMin = startMin + durationMin;
    ({ startMin, endMin } = pushPastConflicts(startMin, endMin, scheduled, bufferMin));

    if (hasConflict(startMin, endMin, scheduled, bufferMin)) {
      ({ startMin, endMin } = pushPastConflicts(startMin, endMin, scheduled, bufferMin));
    }

    if (endMin > windowEnd || endMin > dayEndMin) {
      continue;
    }

    const scheduledItem = {
      ...item,
      startMin,
      endMin,
    };
    scheduled.push(scheduledItem);
    if (scheduledItem.type === "attraction" || scheduledItem.kind === "activity") {
      activityCount += 1;
    }
  }

  return scheduled
    .sort((a, b) => (a.startMin ?? 0) - (b.startMin ?? 0))
    .map((item, index) => ({
      ...item,
      startTime: buildIso(date, minutesToTime(item.startMin ?? dayStartMin)),
      endTime: buildIso(date, minutesToTime(item.endMin ?? dayEndMin)),
      sortKey: buildIso(date, minutesToTime(item.startMin ?? dayStartMin)),
      durationMin: item.durationMin,
      sortIndex: index,
      startMin: undefined,
      endMin: undefined,
    }));
}
