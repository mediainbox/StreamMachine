import {Brand} from "src/helpers/types";

export type DateStr = Brand<string, 'DateStr'>;
export type DateTimeStr = Brand<string, 'DateTimeStr'>;
export type Minutes = Brand<number, 'Minutes'>;
export type Seconds = Brand<number, 'Seconds'>;
export type Milliseconds = Brand<number, 'Milliseconds'>;

export type HourMinute = Brand<string, 'HourMinute'>; // HH:mm format

export type Bytes = Brand<number, 'Bytes'>;
export type Kbytes = Brand<number, 'Kbytes'>;
