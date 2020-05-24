import {EventEmitter} from 'events';
import {Format} from "../types";
import { Writable } from 'stream';

const AacParser = require('./aac');
const Mp3Parser = require('./mp3');

export function getParserForFormat(format: Format): Writable {
  if (format === "aac") {
    return new AacParser();
  }

  if (format === "mp3") {
    return new AacParser();
  }

  throw new Error('Unsupported format');
}
