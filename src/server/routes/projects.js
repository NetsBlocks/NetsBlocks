'use strict';

var _ = require('lodash'),
    Q = require('q'),
    xml2js = require('xml2js'),
    Utils = _.extend(require('../utils'), require('../server-utils.js')),
    middleware = require('./middleware'),
    RoomManager = require('../rooms/room-manager'),
    SocketManager = require('../socket-manager'),
    PublicProjects = require('../storage/public-projects'),
    EXAMPLES = require('../examples'),
    debug = require('debug'),
    log = debug('netsblox:api:projects:log'),
    info = debug('netsblox:api:projects:info'),
    trace = debug('netsblox:api:projects:trace'),
    error = debug('netsblox:api:projects:error');

const Projects = require('../storage/projects');


try {
    info('trying to load lwip');
    var lwip = require('lwip');
} catch (e) {
    error('Could not load lwip:');
    error('aspectRatio for image thumbnails will not be supported');
}


var getProjectIndexFrom = function(name, user) {
    for (var i = user.rooms.length; i--;) {
        if (user.rooms[i].name === name) {
            return i;
        }
    }
    return -1;
};

/**
 * Find and set the given project's public value.
 *
 * @param {String} name
 * @param {User} user
 * @param {Boolean} value
 * @return {Boolean} success
 */
var setProjectPublic = function(name, user, value) {
    var index = getProjectIndexFrom(name, user);
    if (index === -1) {
        return false;
    }
    user.rooms[index].Public = value;

    if (value) {
        PublicProjects.publish(user.rooms[index]);
    } else {
        PublicProjects.unpublish(user.rooms[index]);
    }

    user.save();
    return true;
};

// Select a preview from a project (retrieve them from the roles)
var getPreview = function(project) {
    var preview,
        roles,
        role;

    roles = Object.keys(project.roles);
    preview = {
        ProjectName: project.name,
        Public: !!project.public
    };

    for (var i = roles.length; i--;) {
        role = project.roles[roles[i]];
        if (role) {
            // Get the most recent time
            preview.Updated = Math.max(
                preview.Updated || 0,
                new Date(role.Updated).getTime()
            );

            // Notes
            preview.Notes = preview.Notes || role.Notes;
            preview.Thumbnail = preview.Thumbnail ||
                role.Thumbnail;
        }
    }
    preview.Updated = new Date(preview.Updated);  // to string
    preview.Public = project.Public;
    preview.Owner = project.owner;
    return preview;
};

////////////////////// Project Helpers //////////////////////
var getRoomsNamed = function(name, user, owner) {
    owner = owner || user.username;
    const uuid = Utils.uuid(owner, name);

    trace(`looking up projects ${uuid} for ${user.username}`);
    let getProject = user.username === owner ? user.getProject(name) :
        user.getSharedProject(owner, name);

    return getProject.then(project => {
        var activeRoom;

        if (project) {
            trace(`found project ${uuid} for ${user.username}`);
            activeRoom = RoomManager.rooms[Utils.uuid(project.owner, project.name)];
        } else {
            trace(`no ${uuid} project found for ${user.username}`);
        }

        return {
            active: activeRoom,
            stored: project,
            areSame: !!activeRoom && !!project &&
                activeRoom.originTime === project.originTime
        };
    });
};

var sendProjectTo = function(project, res) {
    var serialized,
        openRole,
        role;

    // If room is not active, pick a role arbitrarily
    openRole = project.activeRole || Object.keys(project.roles)[0];
    role = project.roles[openRole];

    if (!role) {
        error('Found room with no roles!');
        return res.status(500).send('ERROR: project has no roles');
    }

    const uuid = Utils.uuid(project.owner, project.name);
    trace(`project ${uuid} is not active. Selected role "${openRole}"`);
    serialized = Utils.serializeRole(role, project);
    return res.send(serialized);
};

var createCopyFrom = function(user, project) {
    var copy = _.cloneDeep(project);

    // Create copy from the project and rename it
    return user.getNewName(copy.name)
        .then(name => {
            copy.name = name;
            copy.Public = false;
            return copy;
        });
};

var saveRoom = function (activeRoom, socket, user, res) {
    log(`saving entire room for ${socket.username}`);
    const project = Projects.new(user, activeRoom);
    const uuid = Utils.uuid(user.username, activeRoom.name);

    project.setActiveRole(socket.roleId);
    activeRoom.setStorage(project);
    return project.persist()
        .then(() => {
            log(`room save successful for project "${uuid}"`);
            return res.send('project saved!');
        })
        .fail(err => {
            error(`project save failed for "${uuid}": ${err}`);
            return res.status(500).send('ERROR: ' + err);
        });
};

const TRANSPARENT = [0,0,0,0];


var padImage = function (buffer, ratio) {  // Pad the image to match the given aspect ratio
    var lwip = require('lwip');
    return Q.ninvoke(lwip, 'open', buffer, 'png')
        .then(image => {
            var width = image.width(),
                height = image.height(),
                pad = Utils.computeAspectRatioPadding(width, height, ratio);

            return Q.ninvoke(
                image,
                'pad',
                pad.left,
                pad.top,
                pad.right,
                pad.bottom,
                TRANSPARENT
            );
        })
        .then(image => Q.ninvoke(image, 'toBuffer', 'png'));
};


var applyAspectRatio = function (thumbnail, aspectRatio) {
    var image = thumbnail
        .replace(/^data:image\/png;base64,|^data:image\/jpeg;base64,|^data:image\/jpg;base64,|^data:image\/bmp;base64,/, '');
    var buffer = new Buffer(image, 'base64');

    if (aspectRatio && typeof lwip !== 'undefined') {
        trace(`padding image with aspect ratio ${aspectRatio}`);
        aspectRatio = Math.max(aspectRatio, 0.2);
        aspectRatio = Math.min(aspectRatio, 5);
        return padImage(buffer, aspectRatio);
    } else {
        if (aspectRatio) error('module lwip is not available thus setting aspect ratio will not work');
        return Q(buffer);
    }
};

module.exports = [
    {
        Service: 'saveProject',
        Parameters: 'socketId,overwrite',
        Method: 'Post',
        Note: '',
        middleware: ['hasSocket', 'isLoggedIn'],
        Handler: function(req, res) {
            var username = req.session.username,
                socketId = req.body.socketId,
                socket = SocketManager.getSocket(socketId),

                activeRoom = socket._room,
                owner,
                roomName;

            if (!activeRoom) {
                error(`Could not find active room for "${username}" - cannot save!`);
                return res.status(500).send('ERROR: active room not found');
            }

            roomName = activeRoom.name;
            const ownerName = activeRoom.owner;
            return this.storage.users.get(ownerName)
                .then(user => {
                    owner = user;
                    return getRoomsNamed.call(this, roomName, owner);
                })
                .then(rooms => {
                    if (socket.isOwner() || socket.isCollaborator()) {
                        info(`${username} initiating room save for ${activeRoom.uuid}`);

                        // If we overwrite, we don't want to change the originTime
                        if (rooms.stored) {
                            trace(`Found project with same name (${rooms.stored.name}) in database`);
                            activeRoom.originTime = rooms.stored.originTime;
                            if (!rooms.areSame) {
                                trace(`Projects are different: ${rooms.stored.originTime} ` +
                                    `vs ${rooms.active.originTime}`);
                            }
                        } else {
                            trace(`saving first project named ${roomName} for ${username}`);
                        }

                        if (rooms.areSame) {  // overwrite
                            saveRoom.call(this, activeRoom, socket, owner, res);
                        } else if (req.body.overwrite === 'true') {  // overwrite
                            saveRoom.call(this, activeRoom, socket, owner, res);
                        } else {  // rename
                            activeRoom.changeName();
                            activeRoom.originTime = Date.now();
                            saveRoom.call(this, activeRoom, socket, owner, res);
                        }
                    } else {  // Save a copy for the given user and move to the given room
                        RoomManager.forkRoom({room: activeRoom, socket});
                        return res.status(200).send('saved own copy!');
                    }
                });
        }
    },
    {
        Service: 'getSharedProjectList',
        Parameters: '',
        Method: 'Get',
        Note: '',
        middleware: ['isLoggedIn', 'noCache'],
        Handler: function(req, res) {
            var username = req.session.username;
            log(username +' requested project list');

            return this.storage.users.get(username)
                .then(user => {
                    if (user) {
                        return user.getSharedProjects().then(projects => {
                            trace(`found project list (${projects.length}) ` +
                                `for ${username}: ${projects.map(proj => proj.name)}`);

                            const previews = projects.map(getPreview);
                            const names = JSON.stringify(previews.map(preview =>
                                preview.ProjectName));

                            info(`shared projects for ${username} are ${names}`);

                            if (req.query.format === 'json') {
                                return res.json(previews);
                            } else {
                                return res.send(Utils.serializeArray(previews));
                            }
                        });
                    }
                    return res.status(404);
                })
                .catch(e => {
                    this._logger.error(`could not find user ${username}: ${e}`);
                    return res.status(500).send('ERROR: ' + e);
                });
        }
    },
    {
        Service: 'getProjectList',
        Parameters: '',
        Method: 'Get',
        Note: '',
        middleware: ['isLoggedIn', 'noCache'],
        Handler: function(req, res) {
            var username = req.session.username;
            log(username +' requested project list');

            return this.storage.users.get(username)
                .then(user => {
                    if (user) {
                        return user.getRawProjects().then(projects => {
                            trace(`found project list (${projects.length}) ` +
                                `for ${username}: ${projects.map(proj => proj.name)}`);

                            var previews = projects.map(getPreview);

                            info(`Projects for ${username} are ${JSON.stringify(
                                previews.map(preview => preview.ProjectName)
                                )}`
                            );

                            if (req.query.format === 'json') {
                                return res.json(previews);
                            } else {
                                return res.send(Utils.serializeArray(previews));
                            }
                        });
                    }
                    return res.status(404);
                })
                .catch(e => {
                    this._logger.error(`Could not find user ${username}: ${e}`);
                    return res.status(500).send('ERROR: ' + e);
                });
        }
    },
    {
        Service: 'hasConflictingStoredProject',
        Parameters: 'socketId',
        Method: 'post',
        Note: '',
        middleware: ['isLoggedIn', 'hasSocket', 'noCache', 'setUser'],
        Handler: function(req, res) {
            var socket = SocketManager.getSocket(req.body.socketId),
                roomName = socket._room.name,
                user = req.session.user;

            return getRoomsNamed.call(this, roomName, user).then(rooms => {

                var hasConflicting = rooms.stored && !rooms.areSame;

                log(`${user.username} is checking if project "${roomName}" conflicts w/ any saved names (${hasConflicting})`);
                // Check if it is actually the same - do the originTime's match?
                return res.send(`hasConflicting=${!!hasConflicting}`);
            });
        }
    },
    {
        Service: 'isProjectActive',
        Parameters: 'ProjectName',
        Method: 'post',
        Note: '',
        middleware: ['isLoggedIn', 'noCache', 'setUser'],
        Handler: function(req, res) {
            var roomName = req.body.ProjectName,
                user = req.session.user;

            return getRoomsNamed.call(this, roomName, user).then(rooms => {

                log(`${user.username} is checking if project "${req.body.ProjectName}" is active (${rooms.areSame})`);
                // Check if it is actually the same - do the originTime's match?
                return res.send(`active=${rooms.areSame}`);
            });
        }
    },
    {
        Service: 'joinActiveProject',
        Parameters: 'ProjectName,owner',
        Method: 'post',
        Note: '',
        middleware: ['isLoggedIn', 'noCache', 'setUser'],
        Handler: function(req, res) {
            var roomName = req.body.ProjectName,
                user = req.session.user,
                owner = req.body.owner || user.username;

            log(`${user.username} joining active ${owner}/${roomName}`);
            return getRoomsNamed.call(this, roomName, user, owner).then(rooms => {
                // Get the active project and join it
                if (rooms.active) {
                    // Join the project
                    Utils.joinActiveProject(user.username, rooms.active, res);
                } else if (rooms.stored) {  // else, getProject w/ the stored version
                    sendProjectTo(rooms.stored, res);
                } else {  // if there is no stored version, ERROR!
                    res.send('ERROR: Project not found');
                }
            });
        }
    },
    {
        Service: 'getProject',
        Parameters: 'owner,projectName,socketId',
        Method: 'post',
        Note: '',
        middleware: ['isLoggedIn', 'noCache', 'setUser'],
        Handler: function(req, res) {
            var {owner, projectName, socketId} = req.body,
                user = req.session.user,
                socket = socketId && SocketManager.getSocket(socketId);

            if (socket) {
                socket.leave();
            }

            // Get the projectName
            trace(`${user.username} opening shared project ${owner}/${projectName}`);
            return getRoomsNamed.call(this, projectName, user, owner).then(rooms => {
                if (rooms.active) {
                    trace(`room with name ${projectName} already open. Are they the same? ${rooms.areSame}`);
                    if (rooms.areSame) {
                        // Clone, change the room name, and send!
                        // Since they are the same, we assume the user wants to create
                        // a copy of the active room
                        return createCopyFrom(user, rooms.stored)
                            .then(copy => sendProjectTo(copy, res));
                    } else {
                        // not the same; simply change the name of the active room
                        // (the active room must be newer since it hasn't been saved
                        // yet)
                        trace(`active room is ${projectName} already open`);
                        rooms.active.changeName();
                        sendProjectTo(rooms.stored, res);
                    }
                } else if (rooms.stored) {
                    trace(`no active room with name ${projectName}. Proceeding normally`);
                    sendProjectTo(rooms.stored, res);
                } else {
                    res.send('ERROR: Project not found');
                }
            });
        }
    },
    {
        Service: 'deleteProject',
        Parameters: 'ProjectName,RoomName',
        Method: 'Post',
        Note: '',
        middleware: ['isLoggedIn', 'setUser'],
        Handler: function(req, res) {
            var user = req.session.user,
                project = req.body.ProjectName;

            log(user.username +' trying to delete "' + project + '"');
            // Get the project and call "destroy" on it
            return user.getProject(project)
                .then(project => {
                    if (project) {
                        project.destroy();
                        trace(`project ${project.name} deleted`);
                        return res.send('project deleted!');
                    }

                    error(`project ${project} not found`);
                    res.status(400).send(`${project} not found!`);
                });
        }
    },
    {
        Service: 'publishProject',
        Parameters: 'ProjectName',
        Method: 'Post',
        Note: '',
        middleware: ['isLoggedIn', 'setUser'],
        Handler: function(req, res) {
            var name = req.body.ProjectName,
                user = req.session.user;

            log(`${user.username} is publishing project ${name}`);
            var success = setProjectPublic(name, user, true);
            if (success) {
                return res.send(`"${name}" is shared!`);
            }
            return res.send('ERROR: could not find the project');
        }
    },
    {
        Service: 'unpublishProject',
        Parameters: 'ProjectName',
        Method: 'Post',
        Note: '',
        middleware: ['isLoggedIn', 'setUser'],
        Handler: function(req, res) {
            var name = req.body.ProjectName,
                user = req.session.user;

            log(`${user.username} is unpublishing project ${name}`);
            var success = setProjectPublic(name, user, false);
            if (success) {
                return res.send(`"${name}" is no longer shared`);
            }
            return res.send('ERROR: could not find the project');
        }
    },

    // Methods for forum client
    {
        Method: 'get',
        URL: 'projects/:owner',
        middleware: ['setUsername'],
        Handler: function(req, res) {
            var publicOnly = req.params.owner !== req.session.username;

            // return the names of all projects owned by :owner
            middleware.loadUser(req.params.owner, res, user => res.json(
                user.rooms
                    .filter(room => !publicOnly || !!room.Public)
                    .map(room => room.name))
            );

        }
    },
    {
        Method: 'get',
        URL: 'projects/:owner/:project/thumbnail',
        middleware: ['setUsername'],
        Handler: function(req, res) {
            var name = req.params.project,
                aspectRatio = +req.query.aspectRatio || 0;

            // return the names of all projects owned by :owner
            middleware.loadUser(req.params.owner, res, user => {
                var project = user.rooms.find(room => room.name === name),
                    preview = getPreview(project),
                    err;

                if (!project) {
                    err = `could not find project ${name}`;
                    this._logger.error(err);
                    return res.status(400).send(err);
                }

                if (!preview || !preview.Thumbnail) {
                    err = `could not find thumbnail for ${name}`;
                    this._logger.error(err);
                    return res.status(400).send(err);
                }

                this._logger.trace(`Sending thumbnail for ${req.params.owner}'s ${name}`);
                return applyAspectRatio(preview.Thumbnail[0], aspectRatio)
                    .then(buffer => {
                        res.contentType('image/png');
                        res.end(buffer, 'binary');
                    })
                    .fail(err => {
                        this._logger.error(`padding image failed: ${err}`);
                        res.serverError(err);
                    });
            });

        }
    },
    {
        Method: 'get',
        URL: 'examples/:name/thumbnail',
        Handler: function(req, res) {
            var name = req.params.name,
                aspectRatio = +req.query.aspectRatio || 0;

            if (!EXAMPLES.hasOwnProperty(name)) {
                this._logger.warn(`ERROR: Could not find example "${name}`);
                return res.status(500).send('ERROR: Could not find example.');
            }

            // Get the thumbnail
            var example = EXAMPLES[name];
            var role = Object.keys(example.roles).shift();
            var src = example.cachedProjects[role].SourceCode;
            return Q.nfcall(xml2js.parseString, src)
                .then(result => result.project.thumbnail[0])
                .then(thumbnail => applyAspectRatio(thumbnail, aspectRatio))
                .then(buffer => {
                    res.contentType('image/png');
                    res.end(buffer, 'binary');
                })
                .fail(err => {
                    this._logger.error(`padding image failed: ${err}`);
                    res.serverError(err);
                });
        }
    },
    {
        Method: 'get',
        URL: 'RawPublic',
        Handler: function(req, res) {
            var username = req.query.Username,
                projectName = req.query.ProjectName;

            this._logger.trace(`Retrieving the public project: ${projectName} from ${username}`);
            return this.storage.users.get(username)
                .then(user => {
                    if (!user) {
                        log(`Could not find user ${username}`);
                        return res.status(400).send('ERROR: User not found');
                    }
                    var project = user.rooms.find(room => room.name === projectName);
                    if (project && project.Public) {
                        return res.send(Utils.getRoomXML(project));
                    } else {
                        return res.status(400).send('ERROR: Project not available');
                    }
                });
        }
    }

].map(function(api) {
    // Set the URL to be the service name
    api.URL = api.URL || api.Service;
    return api;
});
