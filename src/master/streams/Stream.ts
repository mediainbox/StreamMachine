import {Logger} from "winston";
import _ from "lodash";
import {Readable} from "stream";
import { DEFAULT_CONFIG } from "./config";
import {StreamConfig} from "../types";

const RewindBuffer = require('../../rewind/rewind_buffer');

export class Stream extends EventEmitter {
  private readonly source: IStreamSource;

  constructor(
    private readonly id: string,
    private readonly config: StreamConfig,
    private readonly logger: Logger,
  ) {
    super();

    this.config = _.defaults(config || {}, DEFAULT_CONFIG);

    // We have three options for what source we're going to use:
    // a) Internal: Create our own source mount and manage our own sources.
    //    Basically the original stream behavior.
    // b) Source Mount: Connect to a source mount and use its source
    //    directly. You'll get whatever incoming format the source gets.
    // c) Source Mount w/ Transcoding: Connect to a source mount, but run a
    //    transcoding source between it and us, so that we always get a
    //    certain format as our input.
    this.destroying = false;
    this.source = null;

    // Cache the last stream vitals we've seen
    this._vitals = null;
    this.emitDuration = 0;


    // set up a rewind buffer, for use in bringing new slaves up to date
    // TODO: initialize only on vitals
    this.rewind = new RewindBuffer({
      id: `master__${this.streamId}`,
      streamKey: this.streamId,
      maxSeconds: this.config.seconds,
      initialBurst: this.config.burst,
      logger: this.logger
    });

    // Rewind listens to us, not to our source
    // this.rewind.connectSource(this)
    // this.rewind.emit("source", this);

    // Pass along buffer loads
    this.rewind.on("buffer", (c) => {
      return this.emit("buffer", c);
    });


    this.dataFunc = (data) => {
      // inject our metadata into the data object
      return this.emit("data", _.extend({}, data, {
        meta: this._meta
      }));
    };

    this.vitalsFunc = (vitals) => {
      this._vitals = vitals;
      return this.emit("vitals", vitals);
    };

    // create source
    this.source.on("data", this.dataFunc);
    this.source.on("vitals", this.vitalsFunc);
  }

  getConfig() {
    return this.config;
  }

  status() {
    return {
      // id is DEPRECATED in favor of key
      key: this.streamId,
      id: this.streamId,
      vitals: this._vitals,
      source: this.source.status(),
      rewind: this.rewind.getStatus()
    };
  }

  configure(new_opts, cb) {
    var k, ref, v;
    ref = DEFAULT_OPTIONS;
    // allow updates, but only to keys that are present in @DefaultOptions.
    for (k in ref) {
      v = ref[k];
      if (new_opts[k] != null) {
        this.config[k] = new_opts[k];
      }
      if (_.isNumber(DEFAULT_OPTIONS[k])) {
        // convert to a number if necessary
        this.config[k] = Number(this.config[k]);
      }
    }
    if (this.streamId !== this.config.key) {
      this.streamId = this.config.key;
    }
    // did they update the metaTitle?
    if (new_opts.metaTitle) {
      this.setMetadata({
        title: new_opts.metaTitle
      });
    }
    // Update our rewind settings
    this.rewind.setRewind(this.config.seconds, this.config.burst);
    this.emit("config");
    return typeof cb === "function" ? cb(null, this.config()) : void 0;
  }

  getRewind(): Promise<Readable> {
    return new Promise((resolve, reject) => {
      return this.rewind.dumpBuffer((err: Error | null, _rewind: Readable) => {
        if (err) {
          reject(err);
          return;
        }

        resolve(_rewind);
      });
    });
  }

  destroy() {
    // shut down our sources and go away
    this.destroying = true;

    this.rewind.disconnect();
    this.source.removeListener("data", this.dataFunc);
    this.source.removeListener("vitals", this.vitalsFunc);
    this.dataFunc = this.vitalsFunc = this.sourceMetaFunc = function () {
    };
    this.emit("destroy");
    return true;
  }



  _startSourceMount(key, opts) {
    var mount;
    mount = new SourceMount(key, this.logger, opts);
    if (mount) {
      this.source_mounts[key] = mount;
      return mount;
    } else {
      return false;
    }
  }
}
