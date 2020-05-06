var StreamMachine, defaultConfig;

defaultConfig = require("./default_config");

module.exports = StreamMachine = (function() {
  function StreamMachine() {}

  StreamMachine.StandaloneMode = require("./modes/standalone");

  StreamMachine.MasterMode = require("./modes/master");

  StreamMachine.SlaveMode = require("./modes/slave");

  StreamMachine.Defaults = defaultConfig;

  return StreamMachine;

})();

//# sourceMappingURL=index.js.map
