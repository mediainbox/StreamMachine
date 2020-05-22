import {HttpOutput} from "./HttpOutput";

export class RawOutput extends HttpOutput {
  configure(headers: any) {
    this.res.chunkedEncoding = false;
    this.res.useChunkedEncodingByDefault = false;
    this.res.writeHead(200, headers);
    (this.res as any)._send('');
  }

  shouldPump() {
    return true;
  }
}
