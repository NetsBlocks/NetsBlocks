describe('APIConsumer', function() {
    const ApiConsumer = require('../../../../../src/server/rpc/procedures/utils/api-consumer.js'),
        apiConsumer = new ApiConsumer('testConsumer',''),
        RPCMock = require('../../../../assets/mock-rpc'),
        testRpc = new RPCMock(apiConsumer),
        assert = require('assert'),
        stringJson = '{"name":"Lisa","age":"2","gholi":"foo","friends":[{"avtar":true},23,45,56]}';

    describe('snap structure creation', function() {
        let singleData = {name: 'Jack', age: '30', friends: ['Emily', 'Doug']};
        let multipleData = [
            {name: 'Jack', age: '30', friends: ['Emily', 'Doug']},
            {name: 'Rosa', age: '23', friends: ['Emily', 'Doug']},
            {name: 'Melrose', age: '55', friends: ['Emily', 'Slim']}
        ];


        it('should accept falsy values', function() {
            assert.deepEqual(apiConsumer._createSnapStructure(null), []);
            assert.deepEqual(apiConsumer._createSnapStructure(undefined), []);
            assert.deepEqual(apiConsumer._createSnapStructure({}), []);
            assert.deepEqual(apiConsumer._createSnapStructure([]), []);
        });

        it('should convert single json response to a singe snap structure', function() {
            assert.deepEqual(apiConsumer._createSnapStructure(singleData)[0][1], 'Jack');
        });

        it('should convert array of json response to a array of snap tuples', function() {
            assert.deepEqual(apiConsumer._createSnapStructure(multipleData)[2][1][1], '55');
        });

        it('should convert array of json responses to a array of snap tuples', function() {
            assert.deepEqual(apiConsumer._createSnapStructure(multipleData)[2][1][1], '55');
            assert.deepEqual(apiConsumer._createSnapStructure(multipleData)[2][0][1], 'Melrose');
        });

        it('should work on stringified json', function(){
            assert.deepEqual(apiConsumer._createSnapStructure(stringJson)[2][1], 'foo');
        });

    });


    describe('cache manager filestorage store', function(){
        it('should be able to save and read data to and from cache', done=>{
            let cache = testRpc._rpc._cache;
            cache.set('foo', 'bar', function(err) {
                if (err) { throw err; }
                cache.get('foo', function(err, result) {
                    assert(result,'bar');
                    cache.del('foo', done);
                });
            });
        });
    });

    describe('requestData', ()=>{
        it('should get response from the cache', done => {
            let cache = testRpc._rpc._cache;
            let queryOpts = {
                queryString: '',
                baseUrl: 'http://google.com',
                json: false
            };

            let requestCacheKey = queryOpts.baseUrl + queryOpts.queryString;
            // cache the key for this request to 'response'
            cache.set(requestCacheKey, 'response', function(err) {
                if (err) { throw err; }
                testRpc._rpc._requestData(queryOpts)
                    .then(data => {
                        // requesting for the same key should return 'response' as data
                        assert.deepEqual(data,'response');
                        done();
                    });
            });

        });
    });
});
