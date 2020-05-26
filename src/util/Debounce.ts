const now = function() {
  return Number(new Date());
};

export class Debounce {
  private timeout: NodeJS.Timeout | null = null;
  private last: number = 0;
  private _t: () => void;

  constructor(private wait: number, private cb: null | ((ts: number) => void)) {
    this._t = () => {
      var ago;
      ago = now() - this.last;
      if (ago < this.wait && ago >= 0) {
        return this.timeout = setTimeout(this._t, this.wait - ago);
      } else {
        this.timeout = null;
        return this.cb && this.cb(this.last);
      }
    };
  }

  ping() {
    this.last = now();
    if (!this.timeout) {
      this.timeout = setTimeout(this._t, this.wait);
    }
    return true;
  }

  kill() {
    if (this.timeout) {
      clearTimeout(this.timeout);
    }
    return this.cb = null;
  }
}
