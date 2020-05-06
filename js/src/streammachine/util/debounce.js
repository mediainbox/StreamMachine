var Debounce, now;

now = function() {
  return Number(new Date());
};

module.exports = Debounce = class Debounce {
  constructor(wait, cb) {
    this.wait = wait;
    this.cb = cb;
    this.last = null;
    this.timeout = null;
    this._t = () => {
      var ago;
      ago = now() - this.last;
      if (ago < this.wait && ago >= 0) {
        return this.timeout = setTimeout(this._t, this.wait - ago);
      } else {
        this.timeout = null;
        return this.cb(this.last);
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

};

//# sourceMappingURL=debounce.js.map
