defaultConfig = require "./default_config"

module.exports =
    Modes:
        StandaloneMode: require "./modes/standalone"
        MasterMode:     require "./modes/master"
        SlaveMode:      require "./modes/slave"
    Defaults: defaultConfig
