var BaseOutput, Icy, Shoutcast, _, debug;

_ = require('underscore');

Icy = require("icy");

BaseOutput = require("./base");

debug = require("debug")("sm:outputs:shoutcast");

module.exports = Shoutcast = class Shoutcast extends BaseOutput {
  constructor(stream, opts) {
    super("shoutcast");
    this.stream = stream;
    this.opts = opts;
    this.disconnected = false;
    this.id = null;
    this.pump = true;
    this._lastMeta = null;
    if (this.opts.req && this.opts.res) {
      debug("Incoming Request Headers: ", this.opts.req.headers);
      // -- startup mode...  sending headers -- #
      this.client.offsetSecs = this.opts.req.query.offset || -1;
      this.client.meta_int = this.stream.opts.meta_interval;
      this.opts.res.chunkedEncoding = false;
      this.opts.res.useChunkedEncodingByDefault = false;
      this.headers = {
        "Content-Type": this.stream.opts.format === "mp3" ? "audio/mpeg" : this.stream.opts.format === "aac" ? "audio/aacp" : "unknown",
        "icy-name": this.stream.StreamTitle,
        "icy-url": this.stream.StreamUrl,
        "icy-metaint": this.client.meta_int,
        "Accept-Ranges": "none"
      };
      // write out our headers
      this.opts.res.writeHead(200, this.headers);
      this.opts.res._send('');
      this.stream.startSession(this.client, (err, session_id) => {
        debug(`Incoming connection given session_id of ${session_id}`);
        this.client.session_id = session_id;
        return process.nextTick(() => {
          return this._startAudio(true);
        });
      });
    } else if (this.opts.socket) {
      // -- socket mode... just data -- #
      this.pump = false;
      process.nextTick(() => {
        return this._startAudio(false);
      });
    }
    // register our various means of disconnection
    this.socket.on("end", () => {
      return this.disconnect();
    });
    this.socket.on("close", () => {
      return this.disconnect();
    });
    this.socket.on("error", () => {
      return this.disconnect();
    });
  }

  //----------
  _startAudio(initial) {
    // -- create an Icecast creator to inject metadata -- #

    // the initial interval value that we pass in may be different than
    // the one we want to use later.  Since the initializer queues the
    // first read, we can set both in succession without having to worry
    // about timing
    this.ice = new Icy.Writer(this.client.bytesToNextMeta || this.client.meta_int);
    this.ice.metaint = this.client.meta_int;
    delete this.client.bytesToNextMeta;
    // connect the icecast metadata injector to our output
    this.ice.pipe(this.socket);
    if (initial && this.stream.preroll && !this.opts.req.query.preskip) {
      debug("Pumping preroll");
      return this.stream.preroll.pump(this, this.ice, (err) => {
        debug("Back from preroll. Connecting to stream.");
        return this.connectToStream();
      });
    } else {
      return this.connectToStream();
    }
  }

  //----------
  disconnect() {
    return super.disconnect(() => {
      var ref, ref1, ref2, ref3;
      if ((ref = this.ice) != null) {
        ref.unpipe();
      }
      if ((ref1 = this.source) != null) {
        ref1.disconnect();
      }
      if (!((ref2 = this.socket) != null ? ref2.destroyed : void 0)) {
        return (ref3 = this.socket) != null ? ref3.end() : void 0;
      }
    });
  }

  //----------
  prepForHandoff(cb) {
    // we need to know where we are in relation to the icecast metaint
    // boundary so that we can set up our new stream and keep everything
    // in sync
    this.client.bytesToNextMeta = this.ice._parserBytesLeft;
    // remove the initial client.offsetSecs if it exists
    delete this.client.offsetSecs;
    return typeof cb === "function" ? cb() : void 0;
  }

  //----------
  connectToStream() {
    if (!this.disconnected) {
      return this.stream.listen(this, {
        offsetSecs: this.client.offsetSecs,
        offset: this.client.offset,
        pump: this.pump,
        startTime: this.opts.startTime
      }, (err, source) => {
        var ref;
        this.source = source;
        if (err) {
          if (this.opts.res != null) {
            this.opts.res.status(500).end(err);
          } else {
            if ((ref = this.socket) != null) {
              ref.end();
            }
          }
          return false;
        }
        // set our offset (in chunks) now that it's been checked for availability
        this.client.offset = this.source.offset();
        this.source.onFirstMeta((err, meta) => {
          if (meta) {
            return this.ice.queue(meta);
          }
        });
        this.metaFunc = (data) => {
          if (!(this._lastMeta && _(data).isEqual(this._lastMeta))) {
            this.ice.queue(data);
            return this._lastMeta = data;
          }
        };
        // -- pipe source audio to icecast -- #
        this.source.pipe(this.ice);
        return this.source.on("meta", this.metaFunc);
      });
    }
  }

};

//----------

//# sourceMappingURL=shoutcast.js.map
