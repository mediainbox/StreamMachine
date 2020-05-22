export function toTime(datetime: Date | number) {
  return (datetime instanceof Date ? datetime : new Date(datetime)).toISOString().substr(11);
}
