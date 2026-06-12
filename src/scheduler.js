export function parseTime(value) {
  const match = String(value).match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  if (!match) throw new Error(`Некорректное время: ${value}`);
  return {
    hour: Number(match[1]),
    minute: Number(match[2]),
  };
}

export function nextRunDelayMs(timeValue, now = new Date()) {
  const { hour, minute } = parseTime(timeValue);
  const next = new Date(now);
  next.setHours(hour, minute, 0, 0);

  if (next.getTime() <= now.getTime()) {
    next.setDate(next.getDate() + 1);
  }

  return Math.max(0, next.getTime() - now.getTime());
}

export function createDailyTimer(timeValue, callback) {
  let timer = null;
  let stopped = false;

  const schedule = () => {
    if (stopped) return;
    const delay = nextRunDelayMs(timeValue);
    timer = setTimeout(async () => {
      try {
        await callback();
      } finally {
        schedule();
      }
    }, delay);
  };

  schedule();

  return {
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
  };
}

export function createDelayTimer(hours, callback) {
  const delay = Math.max(1, Number(hours)) * 60 * 60 * 1000;
  const timer = setTimeout(callback, delay);

  return {
    stop() {
      clearTimeout(timer);
    },
  };
}
