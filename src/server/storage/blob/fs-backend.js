const BlobBackend = require('./backend');
const fse = require('fs-extra');
const path = require('path');
const BASE_DIR = process.env.NETSBLOX_BLOB_DIR ||
        path.join(__dirname, '..', '..', '..', '..', 'blob-storage');

class FsBackend extends BlobBackend {

    configure(baseDir) {
        this.baseDir = baseDir || BASE_DIR;
    }

    getName() {
        return `fs`;
    }

    put(type, uuid, data) {
        let typeDir = path.join(this.baseDir, type);
        let filename = path.join(typeDir, uuid);
        return fse.ensureDir(typeDir)
            .then(() => fse.writeFile(filename, data))
            .then(() => path.join(type, uuid));
    }

    get(uuid) {
        let filename = path.join(this.baseDir, uuid);
        return fse.readFile(filename, 'utf8')
            .catch(err => {
                this.logger.error(`Could not read from ${filename}: ${err}`);
                throw err;
            });
    }

    exists(type, uuid) {
        let filename = path.join(this.baseDir, type, uuid);
        return fse.pathExists(filename);
    }

    delete(type, uuid) {
        let filename = path.join(this.baseDir, type, uuid);
        return fse.remove(filename);
    }
}

module.exports = FsBackend;
