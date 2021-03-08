// active client list
class ClientRegistry {

    constructor() {
        this._clientsByUuid = {};
        this._clientsByUsername = {};
        this._clientsByProjectRole = {};
        this._eventHandlers = {};
    }

    add(client) {
        this._addEventHandlers(client);
        this._clientsByUuid[client.uuid] = client;
        this._addToRoleRecords(client);
        this._addToUsernameRecords(client);
    }

    remove(client) {
        delete this._clientsByUuid[client.uuid];
        this._removeFromRoleRecords(client);
        this._removeEventHandlers(client);
    }

    withUuid(uuid) {
        return this._clientsByUuid[uuid];
    }

    withUsername(name) {
        return this._clientsByUsername[name] || [];
    }

    at(projectId, roleId) {
        return this._at(projectId, roleId).slice();
    }

    _at(projectId, roleId) {
        const roleOccupants = this._clientsByProjectRole[projectId] || {};
        const occupants = roleOccupants[roleId] || [];
        return occupants;
    }

    atProject(projectId) {
        const roleOccupants = this._clientsByProjectRole[projectId] || {};
        return Object.values(roleOccupants).flat();
    }

    count() {
        return Object.keys(this._clientsByUuid).length;
    }

    contains(client) {
        const myClient = this.withUuid(client.uuid);
        return !!myClient;
    }

    toArray() {
        return Object.values(this._clientsByUuid);
    }

    _cleanUpEmptyRecords(projectId, roleId) {
        if (this._clientsByProjectRole[projectId]) {
            const clients = this._at(projectId, roleId);
            if (clients.length === 0) {
                delete this._clientsByProjectRole[projectId][roleId];
                const roleCount = Object.keys(this._clientsByProjectRole[projectId] || {}).length;
                if (roleCount === 0) {
                    delete this._clientsByProjectRole[projectId];
                }
            }
        }
    }

    _addEventHandlers(client) {
        const updateHandler = (oldProjectId, oldRoleId) => {
            this._removeFromRoleRecords(client, oldProjectId, oldRoleId);
            this._addToRoleRecords(client);
        };

        const updateUsernameHandler = oldUsername => {
            this._removeFromUsernameRecords(client, oldUsername);
            this._addToUsernameRecords(client);
        };

        client.on('update', updateHandler);
        client.on('updateUsername', updateUsernameHandler);

        this._eventHandlers[client.uuid] = [updateHandler, updateUsernameHandler];
    }

    _removeEventHandlers(client) {
        const [updateHandler, updateUsernameHandler] = this._eventHandlers[client.uuid];
        client.off('update', updateHandler);
        client.off('updateUsername', updateUsernameHandler);
        delete this._eventHandlers[client.uuid];
    }

    _removeFromRoleRecords(client, projectId=client.projectId, roleId=client.roleId) {
        if (!projectId || !roleId) {
            return;
        }
        const clients = this._at(projectId, roleId);
        const index = clients.indexOf(client);
        if (index > -1) {
            clients.splice(index, 1);
        }

        this._cleanUpEmptyRecords(projectId, roleId);
    }

    _addToRoleRecords(client) {
        if (this._hasNoNetworkState(client)) {
            return;
        }

        this._ensureKeyExist(
            this._clientsByProjectRole,
            [client.projectId, client.roleId],
            []
        );
        this._clientsByProjectRole[client.projectId][client.roleId].push(client);
    }

    _addToUsernameRecords(client) {
        if (client.loggedIn) {
            this._ensureKeyExist(this._clientsByUsername, [client.username], []);
            this._clientsByUsername[client.username].push(client);
        }
    }

    _removeFromUsernameRecords(client, username=client.username) {
        const clients = this._clientsByUsername[username] || [];
        const index = clients.indexOf(client);
        if (index > -1) {
            clients.splice(index, 1);
        }
        if (clients.length === 0) {
            delete this._clientsByUsername[username];
        }
    }

    _hasNoNetworkState(client) {
        return !client.projectId || !client.roleId;
    }

    _ensureKeyExist(dict, keys, defValue) {
        const lastKey = keys.pop();
        const subDict = keys.reduce((dict, k) => {
            if (!dict[k]) {
                dict[k] = {};
            }
            return dict[k];
        }, dict);

        if (!subDict[lastKey]) {
            subDict[lastKey] = defValue;
        }
    }
}

module.exports = ClientRegistry;
