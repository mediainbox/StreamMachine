require('@google-cloud/debug-agent').start({
    allowExpressions: true,
    projectId: 'cloud-logger-177603',
    keyFilename: '/path/to/keyfile.json'
});
require("./js/streamer");