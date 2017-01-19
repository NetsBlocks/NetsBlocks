/* eslint-disable no-console*/
var Command = require('commander').Command,
    UserActions = require('../src/server/storage/UserActions'),
    Storage = require('../src/server/storage/Storage'),
    Logger = require('../src/server/logger'),
    Query = require('../src/common/data-query'),
    logger = new Logger('NetsBlox:CLI'),
    storage = new Storage(logger),
    program = new Command();

program
    .option('-l, --long', 'List additional metadata about the sessions')
    .option('--clear', 'Clear the user data records')
    .parse(process.argv);

storage.connect()
    .then(() => {
        logger.trace('About to request sessions');
        return UserActions.sessions();
    })
    .then(sessions => Query.listSessions(sessions, program))
    .catch(err => console.err(err))
    .then(() => storage.disconnect());
/* eslint-enable no-console*/
