const path = require('path');
const http = require("http");
const greenlock = require("greenlock-express");

module.exports = function setupHttpServer({ app, ctx }) {
  const config = ctx.config;
  const logger = ctx.logger.child({
    component: 'http_server',
  });

  if (process.env.NO_GREENLOCK) {
    logger.info("Setup http server on port " + config.http_port);
    server = http.createServer(app);
    server.listen(config.http_port || 80);
    return;
  }

  logger.info(`setup Greenlock http/https servers with ${config.cluster} workers`);
  const packageRoot = path.resolve(__dirname, '../../../..');

  return greenlock.init({
    packageRoot,
    configDir: "./greenlock.d",
    cluster: true,
    workers: config.cluster,
    maintainerEmail: "contact@mediainbox.io"
  }).ready(function(glx) {
    var plainAddr, plainPort, plainServer;
    plainServer = glx.httpServer(app);
    plainAddr = config.http_ip || '0.0.0.0';
    plainPort = config.http_port || 80;
    return plainServer.listen(plainPort, plainAddr, function() {
      var secureAddr, securePort, secureServer;
      secureServer = glx.httpsServer(null, app);
      secureAddr = config.https_ip || '0.0.0.0';
      securePort = config.https_port || 443;
      return secureServer.listen(securePort, secureAddr, function() {
        plainServer.removeAllListeners('error');
        secureServer.removeAllListeners('error');
        return console.log("Greenlock: cluster child on PID " + process.pid);
      });
    });
  }).master(() => {
    return console.log("Greenlock: master on PID " + process.pid);
  });
}
