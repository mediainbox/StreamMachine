var Monitoring, _;

_ = require("lodash");

// Monitoring component
// - checks if a stream has no active sources
// - checks if a slave is responsive/unresponsive
// - checks if a slave buffer is out of sync with masters'
module.exports = Monitoring = class Monitoring extends require("events").EventEmitter {
  constructor(ctx) {
    super();
    this.ctx = ctx;
    this.master = this.ctx.master;
    this.logger = this.ctx.logger.child({
      component: "monitoring"
    });
    // -- check monitored source mounts for sources -- #
    this._streamInt = setInterval(() => {
      var k, ref, results, sm;
      ref = this.master.source_mounts;
      results = [];
      for (k in ref) {
        sm = ref[k];
        if (sm.config.monitored) {
          results.push(this.master.alerts.update("sourceless", sm.key, sm.source == null));
        } else {
          results.push(void 0);
        }
      }
      return results;
    }, 5 * 1000);
    if (this.master.slaves) {
      // -- Monitor Slave Status -- #
      this._pollForSlaveSync();
    }
  }

  //----------
  shutdown() {
    var ref;
    if (this._streamInt) {
      clearInterval(this._streamInt);
    }
    if (this._slaveInt) {
      clearInterval(this._slaveInt);
    }
    return (ref = this.master.slaves) != null ? ref.removeListener("disconnect", this._dFunc) : void 0;
  }

  //----------
  _pollForSlaveSync() {
    // -- Monitor Slave IO for disconnects -- #
    this._dFunc = (slave_id) => {
      // set this in a timeout just in case we're mid-status at the time
      return setTimeout(() => {
        var i, k, len, ref, results;
        ref = ["slave_unsynced", "slave_unresponsive"];
        // mark any alerts as cleared
        results = [];
        for (i = 0, len = ref.length; i < len; i++) {
          k = ref[i];
          results.push(this.master.alerts.update(k, slave_id, false));
        }
        return results;
      }, 3000);
    };
    this.master.slaveServer.on("disconnect", this._dFunc);
    // -- poll for sync -- #
    return this._slaveInt = setInterval(() => {
      var mstatus;
      // -- what is master's status? -- #
      mstatus = this.master._rewindStatus();
      // -- Get slave status -- #
      return this.master.slaveServer.pollForSync((err, statuses) => {
        var i, j, key, len, len1, mobj, mts, ref, results, sobj, stat, sts, ts, unsynced;
        results = [];
        for (i = 0, len = statuses.length; i < len; i++) {
          stat = statuses[i];
          // -- update slave responsiveness -- #
          if (stat.UNRESPONSIVE) {
            this.master.alerts.update("slave_unresponsive", stat.id, true);
            break;
          }
          this.master.alerts.update("slave_unresponsive", stat.id, false);
          // -- are the rewind buffers synced to master? -- #

          // For this we need to run through each stream, and then
          // through each value inside to see if it is within an
          // acceptable range
          unsynced = false;
          for (key in mstatus) {
            mobj = mstatus[key];
            if (sobj = stat.status[key]) {
              ref = ["first_buffer_ts", "last_buffer_ts"];
              for (j = 0, len1 = ref.length; j < len1; j++) {
                ts = ref[j];
                sts = Number(new Date(sobj[ts]));
                mts = Number(mobj[ts]);
                if ((_.isNaN(sts) && _.isNaN(mts)) || ((mts - 10 * 1000) < sts && sts < (mts + 10 * 1000))) {

                } else {
                  // ok
                  this.logger.info(`Slave ${stat.id} sync unhealthy on ${key}:${ts}`, sts, mts);
                  unsynced = true;
                }
              }
            } else {
              unsynced = true;
            }
          }
          results.push(this.master.alerts.update("slave_unsynced", stat.id, unsynced));
        }
        return results;
      });
    }, 10 * 1000);
  }

};
