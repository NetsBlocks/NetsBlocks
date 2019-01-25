describe('azure-translation', function() {
    const utils = require('../../../../assets/utils');
    var TranslationService = utils.reqSrc('rpc/procedures/azure-translation/azure-translation'),
        RPCMock = require('../../../../assets/mock-rpc'),
        translation = new RPCMock(TranslationService);

    utils.verifyRPCInterfaces(translation, [
        ['translate', ['text', 'from', 'to']],
        ['toEnglish', ['text']],
        ['detectLanguage', ['text']],
        ['getSupportedLanguages', []],
    ]);
});
