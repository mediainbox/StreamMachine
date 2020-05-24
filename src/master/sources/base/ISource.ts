import {EventEmitter} from 'events';
import {SourceStatus, SourceVitals} from "../../../types";

export interface ISource extends EventEmitter {
  getType(): string;
  getVitals(): Promise<SourceVitals>;
  getStatus(): SourceStatus;
  disconnect(): void;
}
