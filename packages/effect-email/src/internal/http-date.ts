import { DateTime } from "effect";

const weekDays: readonly string[] = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const months: readonly string[] = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];
const twoDigits = (value: number): string => value.toString().padStart(2, "0");

export const formatHttpDate = (dateTime: DateTime.DateTime): string | undefined => {
  const parts = DateTime.toPartsUtc(dateTime);
  const weekDay = weekDays[parts.weekDay];
  const month = months[parts.month - 1];
  if (parts.millisecond !== 0 || weekDay === undefined || month === undefined) return undefined;
  return `${weekDay}, ${twoDigits(parts.day)} ${month} ${parts.year.toString().padStart(4, "0")} ${twoDigits(parts.hour)}:${twoDigits(parts.minute)}:${twoDigits(parts.second)} GMT`;
};
