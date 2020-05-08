var COMMANDS, args, k, v;

COMMANDS = {
  "source": ["icecast_source2", "Create an Icecast source connection"],
  "listener": ["stream_listener", "Create a stream listener"]
};

args = require("yargs").usage("Usage: $0 [command] [command args]").help('h').alias('h', 'help').demand(1);

for (k in COMMANDS) {
  v = COMMANDS[k];
  (function(k, v) {
    return args.command(k, v[1], function(yargs) {
      var sm_util;
      args.$0 = `${args.$0} ${k}`;
      return sm_util = require(`./util/${v[0]}`);
    });
  })(k, v);
}

args.argv;
