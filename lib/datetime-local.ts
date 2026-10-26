function formatDateTimeLocal(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");

  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

export function addHour(value: string): string {
  if (!value) return "";

  const next = new Date(value);
  if (Number.isNaN(next.getTime())) return "";

  next.setHours(next.getHours() + 1);
  return formatDateTimeLocal(next);
}

export function isValidEndTime(startTime: string, endTime: string): boolean {
  if (!startTime || !endTime) return true;

  const startDate = new Date(startTime);
  const endDate = new Date(endTime);

  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    return false;
  }

  return endDate.getTime() > startDate.getTime();
}
