import {EventEmitter} from 'events';
import {Format} from "../types";
import { Writable } from 'stream';

const AacParser = require('./aac');
const Mp3Parser = require('./mp3');

export function getParserForFormat(format: Format): Writable {
  if (format === Format.AAC) {
    return new AacParser();
  }

  if (format === Format.MP3) {
    return new Mp3Parser();
  }

  throw new Error('Unsupported format');
}
