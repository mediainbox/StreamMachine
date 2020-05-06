var IcecastSource, SourceIn, debug, express, net,
  boundMethodCheck = function(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new Error('Bound instance method accessed before binding'); } };

net = require("net");

express = require("express");

debug = require("debug")("sm:master:source_in");

IcecastSource = require("../sources/icecast_source");

module.exports = SourceIn = (function() {
  class SourceIn extends require("events").EventEmitter {
    constructor(ctx) {
      super();
      this._connection = this._connection.bind(this);
      this._trySource = this._trySource.bind(this);
      this.ctx = ctx;
      this.config = this.ctx.config;
      this.port = this.ctx.config.port;
      this.behind_proxy = this.ctx.config.behind_proxy;
      this.logger = this.ctx.logger.child({
        component: "sourcein"
      });
      // create our server
      this.server = net.createServer((c) => {
        return this._connection(c);
      });
    }

    listen(spec = this.port) {
      //@ctx.master.log.debug "SourceIn listening on ", spec:spec
      debug(`SourceIn listening on ${spec}`);
      return this.server.listen(spec);
    }

    _connection(sock) {
      var parser, readerF, timer;
      boundMethodCheck(this, SourceIn);
      this.log.debug("Incoming source attempt.");
      // immediately attach an error listener so that a connection reset
      // doesn't crash the whole system
      sock.on("error", (err) => {
        return this.log.debug(`Source socket errored with ${err}`);
      });
      // set a timeout for successful / unsuccessful parsing
      timer = setTimeout(() => {
        this.log.debug("Incoming source connection failed to validate before timeout.");
        sock.write("HTTP/1.0 400 Bad Request\r\n");
        return sock.end("Unable to validate source connection.\r\n");
      }, 2000);
      // -- incoming data -- #
      parser = new SourceIn.IcyParser(SourceIn.IcyParser.REQUEST);
      readerF = () => {
        var d, results;
        results = [];
        while (d = sock.read()) {
          results.push(parser.execute(d));
        }
        return results;
      };
      sock.on("readable", readerF);
      parser.once("invalid", () => {
        // disconnect our reader
        sock.removeListener("readable", readerF);
        // close the connection
        return sock.end("HTTP/1.0 400 Bad Request\n\n");
      });
      return parser.once("headersComplete", (headers) => {
        // cancel our timeout
        clearTimeout(timer);
        if (/^(ICE|HTTP)$/.test(parser.info.protocol) && /^(SOURCE|PUT)$/.test(parser.info.method)) {
          this.log.debug("ICY SOURCE attempt.", {
            url: parser.info.url
          });
          this._trySource(sock, parser.info);
          // get out of the way
          return sock.removeListener("readable", readerF);
        }
      });
    }

    _trySource(sock, info) {
      var _authFunc, m, mount;
      boundMethodCheck(this, SourceIn);
      _authFunc = (mount) => {
        var source, source_ip;
        // first, make sure the authorization header contains the right password
        this.log.debug(`Trying to authenticate ICY source for ${mount.key}`);
        if (info.headers.authorization && this._authorize(mount.password, info.headers.authorization)) {
          sock.write("HTTP/1.0 200 OK\n\n");
          this.log.debug(`ICY source authenticated for ${mount.key}.`);
          // if we're behind a proxy, look for the true IP address
          source_ip = sock.remoteAddress;
          if (this.behind_proxy && info.headers['x-forwarded-for']) {
            source_ip = info.headers['x-forwarded-for'];
          }
          // now create a new source
          source = new IcecastSource({
            format: mount.opts.format,
            sock: sock,
            headers: info.headers,
            logger: mount.log,
            source_ip: source_ip
          });
          return mount.addSource(source);
        } else {
          this.log.debug(`ICY source failed to authenticate for ${mount.key}.`);
          sock.write("HTTP/1.0 401 Unauthorized\r\n");
          return sock.end("Invalid source or password.\r\n");
        }
      };
      // -- source request... is the endpoint one that we recognize? -- #
      if (Object.keys(this.ctx.master.source_mounts).length > 0 && (m = RegExp(`^/(${Object.keys(this.ctx.master.source_mounts).join("|")})`).exec(info.url))) {
        debug(`Incoming source matched mount: ${m[1]}`);
        mount = this.ctx.master.source_mounts[m[1]];
        return _authFunc(mount);
      } else {
        debug("Incoming source matched nothing. Disconnecting.");
        this.log.debug("ICY source attempted to connect to bad URL.", {
          url: info.url
        });
        sock.write("HTTP/1.0 401 Unauthorized\r\n");
        return sock.end("Invalid source or password.\r\n");
      }
    }

    _tmp() {
      if (/^\/admin\/metadata/.match(req.url)) {
        res.writeHead(200, headers);
        return res.end("OK");
      } else {
        res.writeHead(400, headers);
        return res.end(`Invalid method ${res.method}.`);
      }
    }

    //----------
    _authorize(stream_passwd, header) {
      var pass, type, user, value;
      // split the auth type from the value
      [type, value] = header.split(" ");
      if (type.toLowerCase() === "basic") {
        value = Buffer.from(value, 'base64').toString('ascii');
        [user, pass] = value.split(":");
        if (pass === stream_passwd) {
          return true;
        } else {
          return false;
        }
      } else {
        return false;
      }
    }

  };

  //----------
  SourceIn.IcyParser = (function() {
    class IcyParser extends require("events").EventEmitter {
      constructor(type) {
        super();
        this["INIT_" + type]();
        this.offset = 0;
      }

      execute(chunk) {
        this.chunk = chunk;
        this.offset = 0;
        this.end = this.chunk.length;
        while (this.offset < this.end) {
          this[this.state]();
          this.offset++;
        }
        return true;
      }

      INIT_REQUEST() {
        this.state = "REQUEST_LINE";
        this.lineState = "DATA";
        return this.info = {
          headers: {}
        };
      }

      consumeLine() {
        var byte, line;
        if (this.captureStart == null) {
          this.captureStart = this.offset;
        }
        byte = this.chunk[this.offset];
        if (byte === 0x0d && this.lineState === "DATA") { // \r
          this.captureEnd = this.offset;
          this.lineState = "ENDING";
          return;
        }
        if (this.lineState === "ENDING") {
          this.lineState = "DATA";
          if (byte !== 0x0a) {
            return;
          }
          line = this.chunk.toString("ascii", this.captureStart, this.captureEnd);
          this.captureStart = void 0;
          this.captureEnd = void 0;
          debug(`Parser request line: ${line}`);
          return line;
        }
      }

      REQUEST_LINE() {
        var line, match;
        line = this.consumeLine();
        if (line == null) {
          return;
        }
        match = this.requestExp.exec(line);
        if (match) {
          [this.info.method, this.info.url, this.info.protocol, this.info.versionMajor, this.info.versionMinor] = match.slice(1, 6);
        } else {
          // this isn't a request line that we understand... we should
          // close the connection
          this.emit("invalid");
        }
        this.info.request_offset = this.offset;
        this.info.request_line = line;
        return this.state = "HEADER";
      }

      HEADER() {
        var line, match;
        line = this.consumeLine();
        if (line == null) {
          return;
        }
        if (line) {
          match = this.headerExp.exec(line);
          return this.info.headers[match[1].toLowerCase()] = match[2];
        } else {
          return this.emit("headersComplete", this.info.headers);
        }
      }

    };

    IcyParser.REQUEST = "REQUEST";

    IcyParser.RESPONSE = "RESPONSE";

    IcyParser.prototype.reinitialize = IcyParser;

    IcyParser.prototype.requestExp = /^([A-Z]+) (.*) (ICE|HTTP)\/(1).(0|1)$/;

    IcyParser.prototype.headerExp = /^([^:]+): *(.*)$/;

    return IcyParser;

  }).call(this);

  return SourceIn;

}).call(this);

//@state = "BODY"

//# sourceMappingURL=source_in.js.map
