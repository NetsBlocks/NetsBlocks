/**
 * The CloudVariables Service provides support for storing variables on the cloud.
 * Variables can be optionally password-protected or stored only for the current user.
 *
 * Cloud variables that are inactive (no reads or writes) for 30 days are subject to deletion.
 *
 * @service
 */
const Storage = require('../../storage');

let _collections = null;
const getCollections = function() {
    if (!_collections) {
        _collections = {};
        _collections.sharedVars = Storage.create('cloud-variables:shared').collection;
        _collections.userVars = Storage.create('cloud-variables:user').collection;
    }
    return _collections;
};

const ensureAuthorized = function(variable, password) {
    if (variable) {
        const authorized = !variable.password ||
            variable.password === password;

        if (!authorized) {
            throw new Error('Unauthorized: incorrect password');
        }
    }
};

const ensureLoggedIn = function(socket) {
    if (!socket.isLoggedIn()) {
        throw new Error('Login required.');
    }
};

const validateVariableName = function(name) {
    if (!/^[\w _()-]+$/.test(name)) {
        throw new Error('Invalid variable name.');
    }
};

const validateContentSize = function(content) {
    const sizeInBytes = content.length*2;  // assuming utf8. Figure ~2 bytes per char
    const mb = 1024*1024;
    if (sizeInBytes > (4*mb)) {
        throw new Error('Variable value is too large.');
    }
};

const CloudVariables = {};

/**
 * Get the value of a cloud variable
 * @param {String} name Variable name
 * @param {String=} password Password (if password-protected)
 */
CloudVariables.getVariable = function(name, password) {
    const {sharedVars} = getCollections();
    const username = this.socket.username;

    return sharedVars.findOne({name: name})
        .then(variable => {
            ensureAuthorized(variable, password);

            if (!variable) {
                throw new Error('Variable not found');
            }

            const query = {
                $set: {
                    lastReader: username,
                    lastReadTime: new Date(),
                }
            };
            return sharedVars.updateOne({name, password}, query)
                .then(() => variable.value);
        });
};

/**
 * Set a cloud variable.
 * If a password is provided on creation, the variable will be password-protected.
 * @param {String} name Variable name
 * @param {String} value Value to store in variable
 * @param {String=} password Password (if password-protected)
 */
CloudVariables.setVariable = function(name, value, password) {
    validateVariableName(name);
    validateContentSize(value);

    const {sharedVars} = getCollections();
    const username = this.socket.username;

    return sharedVars.findOne({name: name})
        .then(variable => {
            ensureAuthorized(variable, password);
            // Set both the password and value in case it gets deleted
            // during this async fn...
            const query = {
                $set: {
                    value,
                    password,
                    lastWriter: username,
                    lastWriteTime: new Date(),
                }
            };

            return sharedVars.updateOne({name: name}, query, {upsert: true})
                .then(() => 'OK');
        });
};

/**
 * Delete a given cloud variable
 * @param {String} name Variable to delete
 * @param {String=} password Password (if password-protected)
 */
CloudVariables.deleteVariable = function(name, password) {
    const {sharedVars} = getCollections();
    return sharedVars.findOne({name: name})
        .then(variable => {
            ensureAuthorized(variable, password);

            return sharedVars.deleteOne({name, password});
        })
        .then(() => 'OK');
};

/**
 * Get the value of a variable for the current user.
 * @param {String} name Variable name
 */
CloudVariables.getUserVariable = function(name) {
    const {userVars} = getCollections();
    const username = this.socket.username;

    ensureLoggedIn(this.socket);
    return userVars.findOne({name: name, owner: username})
        .then(variable => {
            if (!variable) {
                throw new Error('Variable not found');
            }

            const query = {
                $set: {
                    lastReadTime: new Date(),
                }
            };
            return userVars.updateOne({name, owner: username}, query)
                .then(() => variable.value);
        });
};

/**
 * Set the value of the user cloud variable for the current user.
 * @param {String} name Variable name
 * @param {String} value
 */
CloudVariables.setUserVariable = function(name, value) {
    ensureLoggedIn(this.socket);
    validateVariableName(name);
    validateContentSize(value);

    const {userVars} = getCollections();
    const username = this.socket.username;
    const query = {
        $set: {
            value,
            lastWriteTime: new Date(),
        }
    };
    return userVars.updateOne({name, owner: username}, query, {upsert: true})
        .then(() => 'OK');
};

/**
 * Delete the user variable for the current user.
 * @param {String} name Variable name
 * @param {String} value
 */
CloudVariables.deleteUserVariable = function(name) {
    const {userVars} = getCollections();
    const username = this.socket.username;

    ensureLoggedIn(this.socket);
    return userVars.deleteOne({name: name, owner: username})
        .then(() => 'OK');
};

module.exports = CloudVariables;
