/* eslint-disable no-console*/
require('epipebomb')();  // Allow piping to 'head'

var Command = require('commander').Command,
    Storage = require('../src/server/storage/storage'),
    Logger = require('../src/server/logger'),
    rp = require('request-promise'),
    Projects = require('../src/server/storage/projects'),
    logger = new Logger('netsblox:cli:persist'),
    storage = new Storage(logger),
    program = new Command();

const fs = require('fs');
const Q = require('q');

program
    .arguments('<roomUrl>')
    .parse(process.argv);

// Go through the database and get all the transient projects that don't have corresponding rooms
//   - Get the currently open rooms
//   - Get all ids of transient projects that are not open
let url = `http://localhost:${process.env.PORT}/state/rooms`;
const outputPath = `removed-projects-${new Date()}.jsonl`;
const ids = [];
let collection = null;
storage.connect()
    .then(() => rp(url))
    .then(data => {
        collection = Projects.getCollection();
        const roomNamesByOwner = {};
        const rooms = JSON.parse(data);
        rooms.forEach(room => {
            roomNamesByOwner[room.owner] = roomNamesByOwner[room.owner] || [];
            roomNamesByOwner[room.owner].push(room.name);
        });

        const writeStream = fs.createWriteStream(outputPath, {flags: 'w'});
        const deferred = Q.defer();

        collection.find({transient: true}).forEach(doc => {
            var names = roomNamesByOwner[doc.owner] || [];
            if (!names.includes(doc.name)) {
                console.log(`marked transient project for removal: ${doc.owner}/${doc.name}`);
                writeStream.write(JSON.stringify(doc.name, null, 2) + '\n');
                ids.push(doc._id);
            } else {
                console.log(`skipping open transient project: ${doc.owner}/${doc.name}`);
            }
        }, deferred.resolve);

        return deferred.promise;
    })
    .then(() => {
        if (ids.length) {
            console.log('about to remove', ids.length, 'transient projects');
            return collection.deleteMany({$or: ids.map(id => {
                return {_id: id};
            })});
        } else {
            console.log('no projects to remove');
        }
    })
    .then(() => storage.disconnect())
    .catch(err => {
        console.error(err);
        return storage.disconnect();
    });
/* eslint-enable no-console*/
