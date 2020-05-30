import {DateTimeStr, Seconds, Timestamp} from "../types/util";

export function toTime(_datetime: Date | number | string) {
  const datetime = _datetime instanceof Date ? _datetime : new Date(_datetime);

  return `${datetime.toLocaleTimeString()}.${datetime.getMilliseconds()}`;
}

export function toDateTimeStr(datetime: Date | number | string): DateTimeStr {
  return new Date(datetime).toISOString() as DateTimeStr;
}

export function now(): DateTimeStr {
  return new Date().toISOString() as DateTimeStr;
}

export function nowTs(): Timestamp {
  return Date.now() as Timestamp;
}

export function diffSeconds(start: Timestamp, end: Timestamp): Seconds {
  return Math.abs(end - start) / 1000 as Seconds;
}
