var ALERT_TYPES, Alerts, _, nconf, nodemailer, pagerduty;

nconf = require("nconf");

_ = require("underscore");

nodemailer = require("nodemailer");

pagerduty = require("pagerduty");

ALERT_TYPES = {
  sourceless: {
    description: "A monitored stream has lost its only source connection.",
    wait_for: 30
  },
  slave_disconnected: {
    description: "A slave server has lost its connection to the master server.",
    wait_for: 30
  },
  slave_unresponsive: {
    description: "A slave server has stopped responding to our status queries.",
    wait_for: 30
  },
  slave_unsynced: {
    description: "A slave server is out of sync with master.",
    wait_for: 30
  }
};

// Alerts module is responsible for understanding how long we should wait
// before saying something about alert conditions.  Code calls the alert
// class with a code, a key and a state.
module.exports = Alerts = (function() {
  class Alerts extends require("events").EventEmitter {
    constructor(opts) {
      super();
      this.opts = opts;
      this.logger = this.opts.logger;
      if (nconf.get("alerts:email")) {
        this.email = new Alerts.Email(this, nconf.get("alerts:email"));
      }
      if (nconf.get("alerts:pagerduty")) {
        this.pagerduty = new Alerts.PagerDuty(this, nconf.get("alerts:pagerduty"));
      }
      this._states = {};
    }

    //----------
    update(code, key, active) {
      var s;
      if (!ALERT_TYPES[code]) {
        console.log(`Unknown alert type sent: ${code} / ${key}`);
        return false;
      }
      if (!this._states[code]) {
        this._states[code] = {};
      }
      // are we setting or unsetting?
      if (active) {
        if (s = this._states[code][key]) {
          // update our timestamp
          s.last_seen_at = new Date();
          if (s.c_timeout) {
            // make sure there isn't an all-clear waiting to fire
            clearTimeout(s.c_timeout);
          }
          delete s.c_timeout;
        } else {
          // setting for the first time...
          s = this._states[code][key] = {
            code: code,
            key: key,
            triggered_at: new Date(),
            last_seen_at: new Date(),
            alert_sent: false,
            a_timeout: null,
            c_timeout: null
          };
        }
        if (!s.alert_sent && !s.a_timeout) {
          return s.a_timeout = setTimeout(() => {
            return this._fireAlert(s);
          }, ALERT_TYPES[code].wait_for * 1000);
        }
      } else {
        // clear an alert state if it is set
        if (s = this._states[code][key]) {
          if (s.a_timeout) {
            // -- is there an alert timeout set? -- #
            clearTimeout(s.a_timeout);
          }
          delete s.a_timeout;
          if (s.alert_sent && !s.c_timeout) {
            // we had sent an alert, so send a note that the alert has cleared
            return s.c_timeout = setTimeout(() => {
              return this._fireAllClear(s);
            }, ALERT_TYPES[code].wait_for * 1000);
          } else {

          }
        } else {

        }
      }
    }

    // they've always been good...

      //----------
    // no harm, no foul
    _fireAlert(obj) {
      var alert;
      alert = {
        code: obj.code,
        key: obj.key,
        triggered_at: obj.triggered_at,
        description: ALERT_TYPES[obj.code].description
      };
      this.logger.warn(`Alert: ${obj.key} : ${alert.description}`, alert);
      this.emit("alert", alert);
      // mark our alert as sent
      return obj.alert_sent = true;
    }

    //----------
    _fireAllClear(obj) {
      var alert;
      alert = {
        code: obj.code,
        key: obj.key,
        triggered_at: obj.triggered_at,
        last_seen_at: obj.last_seen_at,
        description: ALERT_TYPES[obj.code].description
      };
      this.logger.warn(`Alert Cleared: ${obj.key} : ${alert.description}`, alert);
      this.emit("alert_cleared", alert);
      // we need to delete the alert now that it has been cleared. If the
      // condition returns, it will be as a new event
      return delete this._states[obj.code][obj.key];
    }

  };

  //----------
  Alerts.Email = class Email {
    constructor(alerts, opts) {
      this.alerts = alerts;
      this.opts = opts;
      // -- set up the transport -- #
      this.transport = nodemailer.createTransport(this.opts.mailer_type, this.opts.mailer_options);
      // -- register our listener -- #
      this.alerts.on("alert", (msg) => {
        return this._sendAlert(msg);
      });
      this.alerts.on("alert_cleared", (msg) => {
        return this._sendAllClear(msg);
      });
    }

    //----------
    _sendAlert(msg) {
      var email;
      email = _.extend({}, this.opts.email_options, {
        subject: `[StreamMachine/${msg.key}] ${msg.code} Alert`,
        generateTextFromHTML: true,
        html: `<p>StreamMachine has detected an alert condition of <b>${msg.code}</b> for <b>${msg.key}</b>.</p>

<p>${msg.description}</p>

<p>Condition was first detected at <b>${msg.triggered_at}</b>.</p>`
      });
      return this.transport.sendMail(email, (err, resp) => {
        if (err) {
          this.alerts.logger.error(`Error sending alert email: ${err}`, {
            error: err
          });
          return false;
        }
        return this.alerts.logger.debug(`Alert email sent to ${email.to}.`, {
          code: msg.code,
          key: msg.key
        });
      });
    }

    //----------
    _sendAllClear(msg) {
      var email;
      email = _.extend({}, this.opts.email_options, {
        subject: `[StreamMachine/${msg.key}] ${msg.code} Cleared`,
        generateTextFromHTML: true,
        html: `<p>StreamMachine has cleared an alert condition of <b>${msg.code}</b> for <b>${msg.key}</b>.</p>

<p>${msg.description}</p>

<p>Condition was first detected at <b>${msg.triggered_at}</b>.</p>

<p>Condition was last seen at <b>${msg.last_seen_at}</b>.</p>`
      });
      return this.transport.sendMail(email, (err, resp) => {
        if (err) {
          this.alerts.logger.error(`Error sending all clear email: ${err}`, {
            error: err
          });
          return false;
        }
        return this.alerts.logger.debug(`All clear email sent to ${email.to}.`, {
          code: msg.code,
          key: msg.key
        });
      });
    }

  };

  //----------
  Alerts.PagerDuty = class PagerDuty {
    constructor(alerts, opts) {
      this.alerts = alerts;
      this.opts = opts;
      this.pager = new pagerduty({
        serviceKey: this.opts.serviceKey
      });
      this.incidentKeys = {};
      this.alerts.on("alert", (msg) => {
        return this._sendAlert(msg);
      });
      this.alerts.on("alert_cleared", (msg) => {
        return this._sendAllClear(msg);
      });
    }

    //----------

      // Create the initial alert in PagerDuty.
    // In the callback, if the response contained an incident key,
    // then we'll hold on to that so we can later resolve the alert
    // using the same key.
    _sendAlert(msg) {
      var details;
      details = this._details(msg);
      this.alerts.logger.debug("Sending alert to PagerDuty.", {
        details: details
      });
      return this.pager.create({
        description: `[StreamMachine/${msg.key}] ${msg.code} Alert`,
        details: details,
        callback: (error, response) => {
          if (response.incident_key) {
            this.incidentKeys[details.key] = response.incident_key;
          } else {
            this.alerts.logger.error("PagerDuty response did not include an incident key.", {
              response: response,
              error: error
            });
          }
          return this._logResponse(error, response, "Alert sent to PagerDuty.", msg);
        }
      });
    }

    //----------

      // Mark the alert as "Resolved" in PagerDuty
    // In the callback, whether it was an error or success, we will
    // delete the incident key from the stored keys.
    _sendAllClear(msg) {
      var details;
      details = this._details(msg);
      this.alerts.logger.debug("Sending allClear to PagerDuty.", {
        details: details
      });
      if (this.incidentKeys[details.key]) {
        return this.pager.resolve({
          incidentKey: this.incidentKeys[details.key],
          description: `[StreamMachine/${msg.key}] ${msg.code} Cleared`,
          details: details,
          callback: (error, response) => {
            delete this.incidentKeys[details.key];
            return this._logResponse(error, response, "Alert marked as Resolved in PagerDuty.", msg);
          }
        });
      } else {
        return this.alerts.logger.error("Could not send allClear to PagerDuty. No incident key in system.", {
          keys: this.incidentKeys
        });
      }
    }

    //----------

      // Details to send to PagerDuty. The properties are arbitrary
    // * via  - Just so we know.
    // * code - The alert code ("sourceless", "disconnected").
    // * msg  - The alert description.
    // * key  - A key to identify this alert. This is to help us find the
    //          correct incidentKey when resolving an alert. It's possible
    //          (but unlikely) that two alerts with the same key could
    //          exist at the same time, which would result in the first
    //          alert never being marked as "resolved" in PagerDuty.
    _details(msg) {
      return {
        via: "StreamMachine Alerts",
        code: msg.code,
        description: msg.description,
        key: `${msg.code}/${msg.key}`
      };
    }

    //----------

      // Log the PagerDuty response, whether it was a success or an error.
    _logResponse(error, response, logText, msg) {
      if (error) {
        return this.alerts.logger.error(`Error sending alert to PagerDuty: ${error}`, {
          error: error
        });
      } else {
        return this.alerts.logger.debug(logText, {
          code: msg.code,
          key: msg.key
        });
      }
    }

  };

  return Alerts;

}).call(this);

//# sourceMappingURL=alerts.js.map
