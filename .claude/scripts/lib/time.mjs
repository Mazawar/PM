/**
 * 本地时间工具 — 输出带时区偏移的 ISO 8601 字符串
 *
 * toISOString()  → 2026-06-09T12:45:00.000Z        (UTC)
 * toLocalISO()   → 2026-06-09T20:45:00+08:00        (本地)
 */

export function toLocalISO(date = new Date()) {
  const pad = n => String(n).padStart(2, '0');
  const off = -date.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  const absOff = Math.abs(off);
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}` +
    `${sign}${pad(Math.floor(absOff / 60))}:${pad(absOff % 60)}`
  );
}

/** 可读的本地时间字符串，用于报告和日志（不含时区后缀） */
export function toLocalStr(date = new Date()) {
  const pad = n => String(n).padStart(2, '0');
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    ` ${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}
