/**
 * Wikidata provides access to structured data from all language editions of Wikipedia
 *
 * @service
 */

const ApiConsumer = require('../utils/api-consumer');
const WikidataConsumer = new ApiConsumer('wikidata',
  'https://query.wikidata.org/sparql?format=json&query=', {
    cache: {
      ttl: 5 * 60
    }
  });
const rewordError = err => {
  if (err.statusCode === 404) {
    return
      'Wikidata does not appear to be responding to requests right now. Try again later.';
  }
};

/**
 * Get a list of strings with that satisfy Wikidata query, with a 15 min delay
 * @param {String} wdt identifier for wikidata 'truthy' predicate
 * @param {String} wd identifier for wikidata entity according to Q-number value
 * @returns {Array} List of strings and wikidata Q-number that satisfy query
 */
WikidataConsumer.query = function(wdt, wd) {
  return this._requestData({
      queryString: `SELECT%20%3Fobject%20%3FobjectLabel%20WHERE%20%7B%0A%20%20SERVICE%20wikibase%3Alabel%20%7B%20bd%3AserviceParam%20wikibase%3Alanguage%20"%5BAUTO_LANGUAGE%5D%2Cen".%20%7D%0A%20%20%3Fobject%20wdt%3A${wdt}%20wd%3A${wd}.%0A%7D%0ALIMIT%20100`
    })
    .then(res => {
      var bindings = res.results.bindings;
      const regex = /http:\/\/www\.wikidata\.org\/entity\//gm;
      return bindings.map(bindings => [bindings.object.value.replace(regex,
          ""),
        bindings.objectLabel.value
      ])
    })
    .catch(err => {
      const prettyError = rewordError(err);
      if (prettyError) {
        return this.response.status(500).send(prettyError);
      }
      throw err;
    });
};

/**
 * Get a list of strings with that satisfy Wikidata query, with a 15 min delay
 * @param {String} city identifier for wikidata administrative region
 * @param {String} feature identifier for wikidata entity according to Q-number value
 * @returns {Array} List of wikidata Q-numbers, labels, and geospatial coordinates that satisfy query
 */
WikidataConsumer.geoquery = function(city, feature) {
  return this._requestData({
      queryString: "SELECT%20%3Fobject%20%3FobjectLabel%20%3Fcoordinates%20WHERE%20%7B%0A%20%20SERVICE%20wikibase%3Alabel%20%7B%20bd%3AserviceParam%20wikibase%3Alanguage%20%22%5BAUTO_LANGUAGE%5D%2Cen%22.%20%7D%0A%20%20%3Fobject%20wdt%3AP131*%20wd%3A${city}.%0A%20%20%3Fobject%20wdt%3AP31%20wd%3A${feature}.%0A%20%20%3Fobject%20wdt%3AP625%20%3Fcoordinates.%20%0A%7D%0A"
    })
    .then(res => {
      var bindings = res.results.bindings;
      const regexLabels = /http:\/\/www\.wikidata\.org\/entity\//gm;
      const regexCoordinates = /Point\((.*)\)/gm;
      return bindings.map(bindings => [bindings.object.value.replace(
          regexLabels,
          ""),
        bindings.objectLabel.value,
        bindings.coordinates.value.replace(regexCoordinates, `$1`)
      ])
    })
    .catch(err => {
      const prettyError = rewordError(err);
      if (prettyError) {
        return this.response.status(500).send(prettyError);
      }
      throw err;
    });
};

WikidataConsumer.serviceName = 'Wikidata';

module.exports = WikidataConsumer;
