
'use strict';

const utils = require('./server-utils');
const Projects = require('./storage/projects');
const ProjectActions = require('./storage/project-actions');

var NetworkTopology = function() {
    this._sockets = [];
};

NetworkTopology.prototype.init = function(logger) {
    this._logger = logger.fork('network-topology');
};

NetworkTopology.prototype.onConnect = function(socket) {
    this._sockets.push(socket);
};

NetworkTopology.prototype.onDisconnect = function(socket) {
    const index = this._sockets.indexOf(socket);
    const hasSocket = index !== -1;
    if (hasSocket) {
        this._sockets.splice(index, 1);
        const {projectId, roleId} = socket;
        if (projectId && roleId) {
            this.onClientLeave(projectId, roleId);
        }
    } else {
        this._logger.error(`Could not find socket: ${socket.username}`);
    }
    return hasSocket;
};

NetworkTopology.prototype.getSocket = function(uuid) {
    return this._sockets.find(socket => socket.uuid === uuid);
};

NetworkTopology.prototype.getSocketsAt = function(projectId, roleId) {
    projectId = projectId && projectId.toString();
    return this._sockets.filter(
        socket => socket.projectId === projectId && socket.roleId === roleId
    );
};

NetworkTopology.prototype.getSocketsAtProject = function(projectId) {
    projectId = projectId && projectId.toString();
    return this._sockets.filter(socket => socket.projectId === projectId);
};

NetworkTopology.prototype.setClientState = async function(clientId, projectId, roleId, username) {
    const client = this.getSocket(clientId);

    if (!client) {
        this._logger.info(`Could not set client state for ${clientId}`);
        return Promise.resolve();
    }

    // Update the changed rooms
    const {projectId: oldProjectId, roleId: oldRoleId} = client;
    client.setState(projectId, roleId, username);

    if (oldProjectId && oldRoleId) {
        await this.onClientLeave(oldProjectId, oldRoleId);
    }

    if (oldProjectId !== projectId) {  // moved to a new project
        return this.onRoomUpdate(projectId);
    }
};

NetworkTopology.prototype.getRoomState = function(projectId) {
    return Projects.getRawProjectById(projectId)
        .then(metadata => {
            const ids = Object.keys(metadata.roles).sort();
            const rolesInfo = {};
            const roles = ids.map(id => [metadata.roles[id].ProjectName, id]);

            roles.forEach(pair => {
                // Change this to use the socket id
                const [name, id] = pair;
                const occupants = this.getSocketsAt(projectId, id)
                    .map(socket => {
                        return {
                            uuid: socket.uuid,
                            username: utils.isSocketUuid(socket.username) ?
                                null : socket.username
                        };
                    });
                rolesInfo[id] = {name, occupants};
            });

            return {
                version: Date.now(),
                owner: metadata.owner,
                id: metadata._id.toString(),
                collaborators: metadata.collaborators,
                name: metadata.name,
                roles: rolesInfo
            };
        });
};

NetworkTopology.prototype.onRoomUpdate = function(projectId) {
    // push room update msg to the clients in the project
    return this.getRoomState(projectId)
        .then(state => {
            const clients = this.getSocketsAtProject(projectId);

            const msg = state;
            msg.type = 'room-roles';

            const count = clients.length;
            this._logger.info(`About to send room update for ${projectId} to ${count} clients`);
            clients.forEach(client => client.send(msg));
            return msg;
        });
};

NetworkTopology.prototype.onClientLeave = function(projectId, roleId) {
    return this.onRoomUpdate(projectId)
        .then(state => {  // Check if previous role is now empty
            const isEmpty = state.roles[roleId].occupants.length === 0;

            if (isEmpty) {
                return this.onRoleEmpty(projectId, roleId);
            }
        });
};

NetworkTopology.prototype.onRoleEmpty = function(projectId, roleId) {
    // Get the current (saved) action ID for the role
    const endTime = new Date();
    return Projects.getById(projectId)
        .then(project => project.getRoleActionIdById(roleId))
        .then(async (actionId) => {
            // Update the latest action ID for the role
            await ProjectActions.setLatestActionId(actionId);

            // Clear the actions after that ID
            return ProjectActions.clearActionsAfter(projectId, roleId, actionId, endTime);
        })
};

NetworkTopology.prototype.sockets = function() {
    return this._sockets.slice();
};

NetworkTopology.prototype.socketsFor = function(username) {
    var uuids = Object.keys(this._sockets),
        sockets = [],
        socket;

    for (var i = uuids.length; i--;) {
        socket = this._sockets[uuids[i]];
        if (socket.username === username) {
            sockets.push(socket);
        }
    }
    return sockets;
};

module.exports = new NetworkTopology();