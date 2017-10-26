const types = require('../../../src/server/rpc/input-types.js'),
    assert = require('assert');

describe('RPC Input Types', function() {

    describe('parsing', () => {
        it('should parse structured data to json', () => {
            let rawInput = [['a', 234],['name', 'Hamid'], ['connections', ['b','c','d']], ['children']];
            let parsedInput = types['Object'](rawInput);
            assert.deepEqual(parsedInput.name, 'Hamid');
        });

        it('should parse numbers', () => {
            let rawInput = '4.253';
            let parsedInput = types['Number'](rawInput);
            assert.deepEqual(parsedInput, 4.253);
        });
    });

    describe('validate', () => {

        it('should validate arrays', () => {
            let rawInput = '181',
                type = 'Array';
            assert.throws(() => types[type](rawInput));
        });

        it('should validate structured data', () => {
            let rawInput = [['a', 234],['name', 'Hamid', 'Z'], ['connections', ['b','c','d']], ['children']];
            let type = 'Object';
            assert.throws(() => types[type](rawInput));

            rawInput = [[],['name', 'Hamid'], ['connections', ['b','c','d']], ['children']];
            assert.throws(() => types[type](rawInput));
        });

        it('should validate latitude', () => {
            let rawInput = '91',
                type = 'Latitude';
            assert.throws(() => types[type](rawInput));
            rawInput = '-91';
            assert.throws(() => types[type](rawInput));
        });

        it('should validate longitude', () => {
            let rawInput = '181',
                type = 'Longitude';
            assert.throws(() => types[type](rawInput));
            rawInput = '-180.1';
            assert.throws(() => types[type](rawInput));
        });
    });

});
