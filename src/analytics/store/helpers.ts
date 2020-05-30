import {DateTimeStr} from "../../types/util";
import moment from "moment";

export function getIndexForTs(index: string, ts: DateTimeStr): string {
  return `${index}-${moment(ts).format('YYYY.MM.DD')}`;
}
