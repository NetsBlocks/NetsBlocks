const utils = require('../../../../assets/utils');

describe(utils.suiteName(__filename), function() {
    utils.verifyRPCInterfaces('Traffic', [
        ['search', ['westLongitude', 'northLatitude', 'eastLongitude', 'southLatitude']],
        ['stop']
    ]);
});
