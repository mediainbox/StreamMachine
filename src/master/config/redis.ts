import Redis from "../../stores/RedisStore";
import MasterConfigRedisStore from "./RedisConfigProvider";
import _ from "lodash";
import {Events} from "../../events";

if (this.config.redis != null) {
  // -- load our streams configuration from redis -- #

  // we store streams and sources into Redis, but not our full
  // config object. Other stuff still loads from the config file
  this.logger.debug("initialize Redis connection");
  this.ctx.providers.redis = new Redis(this.config.redis);
  this.configStore = new MasterConfigRedisStore(ctx);
  this.configStore.on("config", (config) => {
    if (config) {
      // stash the configuration
      this.config = _.defaults(config, this.config);
      // (re-)configure our master stream objects
      return this.configure(this.config);
    }
  });
  // Persist changed configuration to Redis
  this.logger.debug("registering config_update listener");
  this.on(Events.Master.CONFIG_UPDATE, () => {
    return this.configStore._update(this.getStreamsAndSourceConfig(), (err) => {
      return this.logger.info(`Redis config update saved: ${err}`);
    });
  });
} else {
  // -- look for hard-coded configuration -- #
  process.nextTick(() => {
    return this.configure(this.config);
  });
}
