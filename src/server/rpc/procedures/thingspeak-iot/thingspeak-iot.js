const ApiConsumer = require('../utils/api-consumer');
const thingspeakIoT = new ApiConsumer('thingspeakIoT',
    'https://api.thingspeak.com/channels/');
const rpcUtils = require('../utils');

let feedParser = data => {
    let fieldMap = {};
    let channel = data.channel;
    for (var prop in channel) {
        if (channel.hasOwnProperty(prop) && prop.match(/field\d/)) {
            var matchGroup = prop.match(/field\d/)[0];
            fieldMap[matchGroup] = channel[matchGroup];
        }
    }
    return data.feeds.map(entry => {
        let time = new Date(entry.created_at);
        let resultObj = {
            Time: time.toISOString(),
        };
        for (let field in fieldMap) {
            if (fieldMap.hasOwnProperty(field)) {
                resultObj[fieldMap[field]] = entry[field];
            }
        }
        return resultObj;
    });
};

let detailParser = item => {
    let metaData = {
        id: item.id,
        name: item.name,
        description: item.description,
        created_at: new Date(item.created_at),
        latitude: item.latitude,
        longitude: item.longitude,
        tags: (function(data) {
            return data.map(tag => {
                return tag.name;
            });
        })(item.tags),
    };
    if (!metaData.latitude || !metaData.longitude || metaData.latitude == 0.0){
        delete metaData.latitude;
        delete metaData.longitude;
    }
    return metaData;
};

let searchParser = responses => {
    let searchResults = responses.map(data => data.channels.map( item => {
        let details = detailParser(item);
        if (!details.latitude) return null;
        return details;
    })).reduce((results, singleRes) => results.concat(singleRes));
    return searchResults;
};

thingspeakIoT._paginatedQueryOpts = function(queryOpts, limit) {
    return this._requestData(queryOpts).then(resp => {
        const perPage = resp.pagination.per_page;
        const availablePages = Math.ceil(resp.pagination.total_entries / perPage);
        const pages = Math.min(availablePages, Math.ceil(limit/perPage));
        let queryOptsList = [];
        for(let i = 1; i <= pages; i++){
            queryOptsList.push({
                queryString: queryOpts.queryString + `&page=${i}`
            });
        }
        return queryOptsList;
    });
};

thingspeakIoT.searchByTag = function(tag, limit) {
    let queryOptions = {
        queryString: tag !== '' ? 'public.json?' +
            rpcUtils.encodeQueryData({
                tag: encodeURIComponent(tag),
            }) : 'public.json',
    };
    limit = limit || 15;
    return this._paginatedQueryOpts(queryOptions, limit).then(queryOptsList => {
        return this._sendStruct(queryOptsList, searchParser);
    });
};

thingspeakIoT.searchByLocation = function(latitude, longitude, distance, limit) {
    let queryOptions = {
        queryString: 'public.json?' +
            rpcUtils.encodeQueryData({
                latitude: latitude,
                longitude: longitude,
                distance: distance === '' ? 100 : distance
            })
    };
    limit = limit || 15;
    return this._paginatedQueryOpts(queryOptions, limit).then(queryOptsList => {
        return this._sendStruct(queryOptsList, searchParser);
    });};

thingspeakIoT.searchByBoth= function(tag, latitude, longitude, distance, limit) {
    let queryOptions = {
        queryString: 'public.json?' +
        rpcUtils.encodeQueryData({
            tag: encodeURIComponent(tag),
            latitude: latitude,
            longitude: longitude,
            distance: distance === '' ? 100 : distance
        })
    };
    limit = limit || 15;
    return this._paginatedQueryOpts(queryOptions, limit).then(queryOptsList => {
        return this._sendStruct(queryOptsList, searchParser);
    });};

thingspeakIoT.channelFeed = function(id, numResult) {
    let queryOptions = {
        queryString: id + '/feeds.json?' + rpcUtils.encodeQueryData({
            results: numResult,
        }),
    };
    return this._sendStruct(queryOptions, feedParser);
};

thingspeakIoT.privateChannelFeed = function(id, numResult, apiKey) {
    if (apiKey !== '') {
        let queryOptions = {
            queryString: id + '/feeds.json?' + rpcUtils.encodeQueryData({
                api_key: apiKey,
                results: numResult,
            }),
        };
        return this._sendStruct(queryOptions, feedParser);
    } else {
        this.response.status(404).send('API key is blank');
    }
};

//put together the data from feeds and channel metadata
thingspeakIoT.channelDetail = function(id) {
    return this._requestData({queryString: id + '.json?'}).then( data => {
        let details = detailParser(data);
        return this._requestData({queryString: id + '/feeds.json?results=10'})
        .then( resp => {
            details.updated_at = new Date(resp.channel.updated_at);
            details.total_entries = resp.channel.last_entry_id;
            for(var prop in resp.channel) {
                if (resp.channel.hasOwnProperty(prop) && prop.match(/field\d/)) {
                    let match = prop.match(/field\d/)[0];
                    details[match] = resp.channel[match];
                }
            }
            this._logger.info('respondig with', details);
            return rpcUtils.jsonToSnapList(details);
        });
    });
};

module.exports = thingspeakIoT;
