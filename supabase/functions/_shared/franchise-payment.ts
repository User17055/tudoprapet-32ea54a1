export type FranchisePaymentScheduleType = "days_after_order" | "fixed_day_next_month";

function saoPauloParts(value: string | Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(typeof value === "string" ? new Date(value) : value);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return { year: Number(map.year), month: Number(map.month), day: Number(map.day) };
}

const isoDate = (year: number, month: number, day: number) =>
  `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

export function franchisePaymentDueDate(input: {
  createdAt: string | Date;
  scheduleType: FranchisePaymentScheduleType;
  termDays: number;
  dueDay?: number | null;
}): string {
  const origin = saoPauloParts(input.createdAt);
  if (input.scheduleType === "fixed_day_next_month") {
    const nextMonth = origin.month === 12 ? 1 : origin.month + 1;
    const nextYear = origin.month === 12 ? origin.year + 1 : origin.year;
    const lastDay = new Date(Date.UTC(nextYear, nextMonth, 0)).getUTCDate();
    const configuredDay = Math.min(31, Math.max(1, Math.trunc(Number(input.dueDay) || 1)));
    return isoDate(nextYear, nextMonth, Math.min(configuredDay, lastDay));
  }

  const termDays = Math.min(365, Math.max(1, Math.trunc(Number(input.termDays) || 7)));
  const result = new Date(Date.UTC(origin.year, origin.month - 1, origin.day + termDays));
  return isoDate(result.getUTCFullYear(), result.getUTCMonth() + 1, result.getUTCDate());
}

