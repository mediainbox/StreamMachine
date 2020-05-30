import {Brand} from "src/helpers/types";

export type Timestamp = Brand<number, 'Timestamp'>;
export type DateStr = Brand<string, 'DateStr'>;
export type DateTimeStr = Brand<string, 'DateTimeStr'>;
export type Minutes = Brand<number, 'Minutes'> | 0;
export type Seconds = Brand<number, 'Seconds'> | 0;
export type Milliseconds = Brand<number, 'Milliseconds'>;
export type HourMinute = Brand<string, 'HourMinute'>; // HH:mm format
export type Bytes = Brand<number, 'Bytes'> | 0;
export type Kbytes = Brand<number, 'Kbytes'> | 0;
