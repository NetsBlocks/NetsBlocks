(function(ProjectStorage) {

    const DataWrapper = require('./data');
    const Q = require('q');
    const _ = require('lodash');
    const blob = require('./blob-storage');

    class Project extends DataWrapper {
        constructor(params) {
            params.data = _.extend(params.data || {});
            params.data.roles = params.data.roles || {};

            // Update seats => roles
            params.data.roles = params.data.roles || params.data.seats;
            delete params.data.seats;

            super(params.db, params.data || {});
            this._logger = params.logger.fork((this._room ? this._room.uuid : this.uuid));
            this._room = params.room;
        }

        fork(room) {
            var params;
            params = {
                room: room,
                logger: this._logger,
                lastUpdateAt: Date.now(),
                db: this._db
            };
            this._logger.trace('forking (' + room.uuid + ')');
            return new Project(params);
        }

        collectProjects() {
            var sockets = this._room.sockets();
            // Add saving the cached projects
            return Q.all(sockets.map(socket => socket.getProjectJson()))
                .then(projects => {
                    // create the room from the projects
                    var roles = [];

                    sockets.forEach((socket, i) => roles.push([socket.roleId, projects[i]]));
                    return roles;
                });
        }

        // Override
        prepare() {
            return this.collectProjects()
                .then(roles => {
                    this._logger.trace('collected projects for ' + this.owner);

                    this.clean();  // remove any null roles
                    return Q.all(roles.map(pair => {
                        let [name, role] = pair;
                        return Q.all([blob.store(role.SourceCode), blob.store(role.Media)])
                            .then(hashes => {
                                let [srcHash, mediaHash] = hashes;
                                role.SourceCode = srcHash;
                                role.Media = mediaHash;
                                this.roles[name] = role;
                            });
                    }));

                    this.lastUpdateAt = Date.now();
                });
        }

        setActiveRole(role) {
            this.activeRole = role;
        }

        pretty() {
            var prettyRoom = {
                name: this.name,
                roles: {},
                owner: this.owner,
                collaborators: this.collaborators
            };

            Object.keys(this.roles || {})
                .forEach(role => {
                    if (prettyRoom.roles[role]) {
                        prettyRoom.roles[role] = '<project xml>';
                    }
                });

            return prettyRoom;
        }

        clean () {
            let allRoleNames = Object.keys(this.roles),
                removed = [],
                name;

            for (let i = allRoleNames.length; i--;) {
                name = allRoleNames[i];
                if (!this.roles[name]) {
                    removed.push(name);
                    delete this.roles[name];
                }
            }

            if (removed.length) {
                logger.warn(`Found ${removed.length} null roles in ${this.uuid}. Removing...`);
            }

            return this;
        }

    }

    var EXTRA_KEYS = ['_room'];
    Project.prototype.IGNORE_KEYS = DataWrapper.prototype.IGNORE_KEYS.concat(EXTRA_KEYS);

    // Project Storage
    var logger,
        collection;

    const loadProjectBinaryData = function(project) {
        project.clean();

        var roles = Object.keys(project.roles).map(name => project.roles[name]);
        return Q.all(roles.map(loadRole))
            .then(() => project);
    };

    const loadRole = function(role) {
        const srcHash = role.SourceCode;
        const mediaHash = role.Media;
        return Q.all([blob.get(srcHash), blob.get(mediaHash)])
            .then(content => {
                [role.SourceCode, role.Media] = content;
                return role;
            });
    };

    ProjectStorage.init = function (_logger, db) {
        logger = _logger.fork('projects');
        collection = db.collection('projects');
    };

    ProjectStorage.get = function (username, projectName) {
        return collection.findOne({owner: username, name: projectName})
            .then(data => {
                var params = {
                    logger: logger,
                    db: collection,
                    data
                };
                return data ? new Project(params) : null;
            });
    };

    ProjectStorage.getProject = function (username, projectName) {
        return ProjectStorage.get(username, projectName)
            .then(project => {
                var promise = Q(project);

                if (project) {
                    promise = loadProjectBinaryData(project);
                }
                return promise;
            });
    };

    ProjectStorage.getRawUserProjects = function (username) {
        return collection.find({owner: username}).toArray();
    };

    ProjectStorage.getUserProjects = function (username) {
        return ProjectStorage.getRawUserProjects(username)
            .then(projects => Q.all(projects.map(loadProjectBinaryData)));
    };

    // Create room from ActiveRoom (request projects from clients)
    const getDefaultProjectData = function(user, room) {
        return {
            owner: user.username,
            name: room.name,
            originTime: room.originTime,
            activeRole: user.roleId,
            roles: {}
        };
    };

    ProjectStorage.new = function(user, activeRoom) {
        return new Project({
            logger: logger,
            db: collection,
            data: getDefaultProjectData(user, activeRoom),
            room: activeRoom
        });
    };

})(exports);
