// This is a wrapper around the storage room. It provides the extra functionality expected
// of a room that is actively being used

'use strict';

var R = require('ramda'),
    _ = require('lodash'),
    Q = require('q'),
    utils = require('../server-utils'),
    Users = require('../storage/users'),
    Constants = require('../../common/constants');

class ActiveRoom {

    constructor(logger, name, owner) {
        this.name = name;
        this.originTime = Date.now();

        // Seats
        this.roles = {};  // actual occupants
        this.collaborators = [];

        this.cachedProjects = {};

        this.owner = owner;

        // RPC contexts
        this.rpcs = {};

        // Saving
        this._project = null;

        this.uuid = utils.uuid(owner, name);
        this._logger = logger.fork('active-room:' + this.uuid);
        this._logger.log('created!');
    }

    addCollaborator(username) {
        if (this.collaborators.includes(username)) return;
        this.collaborators.push(username);
        this.onRolesChanged();
        this.save();
    }

    removeCollaborator(username) {
        var index = this.collaborators.indexOf(username);
        if (index === -1) return;
        this.collaborators.splice(index, 1);
        this.onRolesChanged();
        this.save();
    }

    close () {
        // Remove all sockets from this group
        var msg = {type: 'project-closed'};
        this.sockets().forEach(socket => socket.send(msg));
        this.destroy();
    }

    // This should only be called by the RoomManager (otherwise, the room will not be recorded)
    fork (logger, socket) {
        // Create a copy of the room with the socket as the new owner
        var fork = new ActiveRoom(logger, this.name, socket.username),
            roles = Object.keys(this.roles),
            data;

        // Clone the room storage data
        if (this._project) {
            data = this._project.fork(fork);
            fork.setStorage(data);
        } else {
            this._logger.error('ERROR: no store defined for room "' + this.name + '"');
        }

        roles.forEach(role => fork.silentCreateRole(role));

        // Copy the data from each project
        fork.cachedProjects = _.cloneDeep(this.cachedProjects);

        // Notify the socket of the fork
        socket.send({
            type: 'project-fork',
            room: fork.name
        });
        fork.onRolesChanged();
        this.onRolesChanged();

        return fork;
    }

    add (socket, role) {
        this._logger.trace(`adding ${socket.uuid} to ${role}`);
        this.roles[role] = socket;
        socket.roleId = role;
        this.onRolesChanged();  // Update all clients
    }

    getStateMsg () {
        var occupants = {},
            msg;

        Object.keys(this.roles)
            .forEach(role => {
                occupants[role] = this.roles[role] ? this.roles[role].username : null;
            });

        msg = {
            type: 'room-roles',
            owner: this.owner,
            collaborators: this.collaborators,
            name: this.name,
            occupants: occupants
        };
        return msg;
    }

    setStorage(store) {
        this._project = store;
    }

    getOwner() {
        // Look up the owner in the user storage
        return Users.get(this.owner);
    }

    setOwner(owner) {
        this.owner = owner;
        this.changeName();
    }

    changeName(name) {
        var promise = Q(name);
        if (!name) {
            // make sure name is also unique to the existing rooms...
            let activeRoomNames = this.getAllActiveFor(this.owner);  // TODO: Update owner to username
            this._logger.trace(`all active rooms for ${this.owner} are ${activeRoomNames}`);

            // Get name unique to the owner
            promise = this.getOwner()
                .then(owner => owner ?
                    owner.getNewName(this.name, activeRoomNames) : this.name);
        }
        return promise.then(name => {
            this.update(name);
            return name;
        });
    }

    save() {
        if (this._project) {  // has been saved
            this._project.save();
        }
    }

    move (params) {
        var src = params.src || params.socket.roleId,
            socket = params.socket,
            dst = params.dst;

        if (socket) {
            // socket should equal this.roles[src]!
            if (socket !== this.roles[src]) {
                var rolesList = Object.keys(this.roles)
                    .map(role => `${role}: ${this.roles[role] && this.roles[role].username}`)
                    .join('\n');

                this._logger.error(`room "${this.name}" is out of sync! ${src} should have ` +
                    `${socket.username} but has ${this.roles[src] && this.roles[src].username}` +
                    `.\nPrinting all roles: ${rolesList}`);

                if (this.roles[src]) {  // notify the socket of it's removal!
                    var currSocket = this.roles[src];
                    currSocket.newRoom();
                    this._logger.error(`Moved ${this.roles[src].username} from ${this.name} (${src})` +
                        ` to ${currSocket._room.name} (${currSocket.roleId})`);

                    // Send message to currSocket to explain the move
                    currSocket.send({
                        type: 'notification',
                        message: `${socket.username} has taken your spot.\nYou have been moved ` +
                            ` to a new project.`
                    });
                }
            }
        }

        socket = socket || this.roles[src];
        this._logger.info(`moving from ${src} to ${dst}`);
        this.roles[src] = null;
        this.add(socket, dst);
        this.check();
    }

    sendFrom (socket, msg) {
        this.sockets()
            .filter(s => s !== socket)  // Don't send to origin
            .forEach(socket => socket.send(msg));
    }

    // Send to everyone, including the origin socket
    sendToEveryone (msg) {
        // Set the dstId to CONSTANTS.EVERYONE if not already set
        if (!msg.dstId) {
            msg.dstId = Constants.EVERYONE;
        }
        this.sockets().forEach(socket => socket.send(msg));
    }
 
    sockets () {
        return R.values(this.roles)
            .filter(socket => !!socket);
    }

    ownerCount () {
        return this.sockets()
            .map(socket => socket.username)
            .filter(name => name === this.owner)
            .length;
    }

    contains (username) {
        var roles = Object.keys(this.roles),
            socket;

        for (var i = roles.length; i--;) {
            socket = this.roles[roles[i]];
            if (socket && socket.username === username) {
                return true;
            }
        }
        return false;
    }

    update (name) {
        var oldUuid = this.uuid;
        this.name = name || this.name;
        this.uuid = utils.uuid(this.owner, this.name);

        if (this.uuid !== oldUuid) {
            this._logger.trace('Updating uuid to ' + this.uuid);
            this.onUuidChange(oldUuid);
        }
        if (name) {
            this.onRolesChanged();
        }
    }

    /////////// Role Operations ///////////
    createRole (role) {
        this.silentCreateRole(role);
        this.onRolesChanged();
    }

    silentCreateRole (role) {
        this._logger.trace(`Adding role ${role}`);
        if (!this.roles[role]) {
            this.roles[role] = null;
        }
    }

    updateRole () {
        this.onRolesChanged();
    }

    removeRole (id) {
        this._logger.trace(`removing role "${id}"`);

        delete this.roles[id];

        this.check();
        this.onRolesChanged();
    }

    renameRole (roleId, newId) {
        var socket = this.roles[roleId];

        if (this.roles[newId]) {
            this._logger.warn(`Cannot rename role: "${newId}" is already taken`);
            return;
        }
        if (socket) {  // update socket, too!
            socket.roleId = newId;
        }

        delete this.roles[roleId];
        this.roles[newId] = socket;
        this.cachedProjects[newId] = this.cachedProjects[roleId];
        delete this.cachedProjects[roleId];

        if (!this.cachedProjects[newId]) {
            this.cachedProjects[newId] = {};
        }

        this.cachedProjects[newId].ProjectName = newId;

        this.onRolesChanged();
        this.check();
    }

    onRolesChanged () {
        // This should be called when the room layout changes
        // Send the room info to the socket
        var msg = this.getStateMsg();

        this.sockets().forEach(socket => socket.send(msg));

        this.save();
    }

    /////////// Caching and Saving ///////////
    cache (role, callback) {
        this._logger.trace('caching ' + role);

        var socket = this.roles[role];

        if (!socket) {
            return Q().then(() => {
                let err = 'No socket in ' + role;
                this._logger.error(err);
                throw err;
            });
        }

        // Get the project json from the socket
        return socket.getProjectJson()
            .then(project => {
                this.cachedProjects[role] = project;
                return project;
            })
            .nodeify(callback);
    }

    // Retrieve a dictionary of role => project content
    collectProjects() {
        // Collect the projects from the websockets
        const sockets = this.sockets();
        const projects = sockets.map(socket => socket.getProjectJson());

        // Add saving the cached projects
        return Q.all(projects).then(projects => {
            // create the room from the projects
            var roles = Object.keys(this.roles),
                socket,
                k,
                content = {
                };

            for (var i = roles.length; i--;) {
                socket = this.roles[roles[i]];

                k = sockets.indexOf(socket);
                if (k !== -1) {
                    content[roles[i]] = projects[k];
                } else {  // socket is closed -> use the cache
                    content[roles[i]] = this.cachedProjects[roles[i]] || null;
                }
            }
            return content;
        });
    }

}

// Factory method
ActiveRoom.fromStore = function(logger, socket, data) {
    var room = new ActiveRoom(logger, data.name, data.owner);

    // Store the data
    room.setStorage(data);
    room.originTime = data.originTime;
    room.collaborators = data.collaborators;

    // Set up the roles
    room._uuid = data.uuid;  // save over the old uuid even if it changes
                              // this should be reset if the room is forked TODO
    // load cached projects
    room.cachedProjects = data.roles || data.seats;

    // Add the roles
    Object.keys(room.cachedProjects).forEach(role => room.roles[role] = null);
    return room;
};

module.exports = ActiveRoom;
