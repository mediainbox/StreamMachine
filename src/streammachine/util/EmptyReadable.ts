import { Readable } from "stream";

export class EmptyReadable extends Readable {
  constructor() {
    super();
    this.push(null);
  }
}
