'use strict';
var R = require('ramda'),
    _ = require('lodash'),
    Utils = _.extend(require('../Utils'), require('../ServerUtils.js')),
    UserAPI = require('./Users'),
    RoomAPI = require('./Rooms'),
    ProjectAPI = require('./Projects'),
    EXTERNAL_API = UserAPI
        .concat(ProjectAPI)
        .concat(RoomAPI)
        .filter(api => api.Service)
        .map(R.omit.bind(R, 'Handler'))
        .map(R.omit.bind(R, 'middleware')),
    GameTypes = require('../GameTypes'),

    debug = require('debug'),
    log = debug('NetsBlox:API:log'),
    fs = require('fs'),
    path = require('path'),
    EXAMPLES = require('../examples'),
    mailer = require('../mailer'),
    middleware = require('./middleware'),
    saveLogin = middleware.saveLogin,

    // PATHS
    PATHS = [
        'Costumes',
        'Sounds',
        'libraries',
        'help',
        'Backgrounds'
    ],
    CLIENT_ROOT = path.join(__dirname, '..', '..', 'client', 'Snap--Build-Your-Own-Blocks'),
    PUBLIC_FILES = [
        'snap_logo_sm.png',
        'tools.xml'
    ];

var createIndexFor = function(name, list) {
    return list
        .filter(item => item.toUpperCase() !== name.toUpperCase())
        .map(function(item) {
            return [item, item, item].join('\t');
        }).join('\n');
};


// Create the paths
var resourcePaths = PATHS.map(function(name) {
    var resPath = path.join(CLIENT_ROOT, name);

    return { 
        Method: 'get', 
        URL: name + '/:filename',
        Handler: function(req, res) {
            if (req.params.filename === name.toUpperCase()) {  // index
                // Load the costumes and create rough HTML content...
                fs.readdir(resPath, function(err, resources) {
                    if (err) {
                        return res.send(err);
                    }

                    var result = createIndexFor(name, resources);
                    return res.send(result);
                });
            } else {  // retrieve a file
                res.sendFile(path.join(resPath, req.params.filename));
            }
        }
    };
});

// Add importing tools, logo to the resource paths
resourcePaths = resourcePaths.concat(PUBLIC_FILES.map(file => {
    return {
        Method: 'get', 
        URL: file,
        Handler: function(req, res) {
            res.sendFile(path.join(CLIENT_ROOT, file));
        }
    };
}));

// Add importing rpcs to the resource paths
var rpcManager = require('../rpc/RPCManager'),
    RPC_ROOT = path.join(__dirname, '..', 'rpc', 'libs'),
    RPC_INDEX = fs.readFileSync(path.join(RPC_ROOT, 'RPC'), 'utf8')
        .split('\n')
        .filter(line => {
            var parts = line.split('\t'),
                deps = parts[2] ? parts[2].split(' ') : [],
                displayName = parts[1];

            // Check if we have loaded the dependent rpcs
            for (var i = deps.length; i--;) {
                if (!rpcManager.isRPCLoaded(deps[i])) {
                    // eslint-disable-next-line no-console
                    console.log(`Service ${displayName} not available because ${deps[i]} is not loaded`);
                    return false;
                }
            }
            return true;
        })
        .map(line => line.split('\t').splice(0, 2).join('\t'))
        .join('\n');

var rpcRoute = { 
    Method: 'get', 
    URL: 'rpc/:filename',
    Handler: function(req, res) {
        var RPC_ROOT = path.join(__dirname, '..', 'rpc', 'libs');

        // IF requesting the RPC file, filter out unsupported rpcs
        if (req.params.filename === 'RPC') {
            res.send(RPC_INDEX);
        } else {
            res.sendFile(path.join(RPC_ROOT, req.params.filename));
        }
    }
};
resourcePaths.push(rpcRoute);

module.exports = [
    { 
        Method: 'get', 
        URL: 'ResetPW',
        Handler: function(req, res) {
            log('password reset request:', req.query.Username);
            var self = this,
                username = req.query.Username;

            // Look up the email
            self.storage.users.get(username, function(e, user) {
                if (e) {
                    log('Server error when looking for user: "'+username+'". Error:', e);
                    return res.status(500).send('ERROR: ' + e);
                }

                if (user) {
                    delete user.hash;  // force tmp password creation
                    user.save();
                    return res.sendStatus(200);
                } else {
                    log('Could not find user to reset password (user "'+username+'")');
                    return res.status(400).send('ERROR: could not find user "'+username+'"');
                }
            });
        }
    },
    { 
        Method: 'post',  // post would make more sense...
        URL: 'SignUp',
        Handler: function(req, res) {
            log('Sign up request:', req.body.Username, req.body.Email);
            var self = this,
                uname = req.body.Username,
                password = req.body.Password,
                email = req.body.Email;

            // Must have an email and username
            if (!email || !uname) {
                log('Invalid request to /SignUp');
                return res.status(400).send('ERROR: need both username and email!');
            }

            self.storage.users.get(uname, function(e, user) {
                if (!user) {
                    var newUser = self.storage.users.new(uname, email);
                    newUser.hash = password || null;
                    newUser.save();
                    return res.send('User Created!');
                }
                log('User "'+uname+'" already exists. Could not make new user.');
                return res.status(401).send('ERROR: user exists');
            });
        }
    },
    { 
        Method: 'post',
        URL: 'SignUp/validate',
        Handler: function(req, res) {
            log('Signup/validate request:', req.body.Username, req.body.Email);
            var self = this,
                uname = req.body.Username,
                password = req.body.Password,
                email = req.body.Email;

            // Must have an email and username
            if (!email || !uname) {
                log('Invalid request to /SignUp/validate');
                return res.status(400).send('ERROR: need both username and email!');
            }

            self.storage.users.get(uname, function(e, user) {
                if (!user) {
                    return res.send('Valid User Signup Request!');
                }
                log('User "'+uname+'" already exists.');
                return res.status(401).send('ERROR: user exists');
            });
        }
    },
    { 
        Method: 'post', 
        URL: '',  // login/SignUp method
        Handler: function(req, res) {
            var hash = req.body.__h,
                isUsingCookie = !req.body.__u,
                socket;

            // Should check if the user has a valid cookie. If so, log them in with it!
            middleware.tryLogIn(req, res, (err, loggedIn) => {
                let username = req.body.__u || req.session.username;
                if (err) {
                    return res.status(500).send(err);
                }

                if (!username) {
                    log(`"passive" login failed - no session found!`);
                    if (req.body.silent) {
                        return res.sendStatus(204);
                    } else {
                        return res.sendStatus(403);
                    }
                }

                // Explicit login
                log(`Logging in as ${username}`);
                this.storage.users.get(username, (e, user) => {
                    if (e) {
                        log(`Could not find user "${username}": ${e}`);
                        return res.status(500).send('ERROR: ' + e);
                    }

                    if (user && (loggedIn || user.hash === hash)) {  // Sign in 
                        if (!isUsingCookie) {
                            saveLogin(res, user, req.body.remember);
                        }

                        log(`"${user.username}" has logged in.`);

                        // Associate the websocket with the username
                        socket = this.sockets[req.body.socketId];
                        if (socket) {  // websocket has already connected
                            socket.onLogin(user);
                        }

                        if (req.body.return_user) {
                            return res.status(200).json({
                                username: username,
                                admin: user.admin,
                                email: user.email,
                                api: req.body.api ? Utils.serializeArray(EXTERNAL_API) : null
                            });
                        } else {
                            return res.status(200).send(Utils.serializeArray(EXTERNAL_API));
                        }
                    } else {
                        if (user) {
                            log(`Incorrect password attempt for ${user.username}`);
                            return res.status(403).send(`Incorrect password`);
                        }
                        log(`Could not find user "${username}"`);
                        return res.status(403).send(`Could not find user "${username}"`);
                    }
                });
            });
        }
    },
    // Add game types query
    { 
        Method: 'get', 
        URL: 'GameTypes',
        Handler: function(req, res) {
            return res.status(200).json(GameTypes);
        }
    },
    // index
    {
        Method: 'get',
        URL: 'Examples/EXAMPLES',
        Handler: function(req, res) {
            // if no name requested, get index
            var result = Object.keys(EXAMPLES)
                .map(name => `${name}\t${name}\t  `)
                .join('\n');
            return res.send(result);
        }
    },
    // individual example
    {
        Method: 'get',
        URL: 'Examples/:name',
        middleware: ['hasSocket'],
        Handler: function(req, res) {
            var name = req.params.name,
                uuid = req.query.socketId,
                isPreview = req.query.preview,
                socket,
                example;

            if (!EXAMPLES.hasOwnProperty(name)) {
                this._logger.warn(`ERROR: Could not find example "${name}`);
                return res.status(500).send('ERROR: Could not find example.');
            }

            // This needs to...
            //  + create the room for the socket
            example = _.cloneDeep(EXAMPLES[name]);
            socket = this.sockets[uuid];
            var role,
                room;

            if (!isPreview) {
                // Check if the room already exists
                room = this.rooms[Utils.uuid(socket.username, name)];

                if (!room) {  // Create the room
                    room = this.createRoom(socket, name);
                    room = _.extend(room, example);
                    // Check the room in 10 seconds
                    setTimeout(this.checkRoom.bind(this, room), 10000);
                }

                // Add the user to the given room
                return Utils.joinActiveProject(uuid, room, res);

            } else {
                room = example;
                room.owner = socket;
                //  + customize and return the room for the socket
                room = _.extend(room, example);
                role = Object.keys(room.roles).shift();
            }

            return res.send(room.cachedProjects[role].SourceCode);
        }
    },
    // Bug reporting
    {
        Method: 'post',
        URL: 'BugReport',
        Handler: function(req, res) {
            var user = req.body.user,
                report = req.body,
                screenshot = report.screenshot;

            if (user) {
                this._logger.info(`Received bug report from ${user}`);
            } else {
                this._logger.info('Received anonymous bug report');
            }

            // email this to the maintainer
            if (process.env.MAINTAINER_EMAIL) {
                var mailOpts = {
                    from: 'bug-reporter@netsblox.org',
                    to: process.env.MAINTAINER_EMAIL,
                    subject: 'Bug Report' + (user ? ' from ' + user : ''),
                    markdown: 'Hello,\n\nA new bug report has been created' +
                        (user !== null ? ' by ' + user : '') + ':\n\n---\n\n' +
                        report.description + '\n\n---\n\n',
                    attachments: [
                        {
                            filename: 'bug-report.json',
                            content: JSON.stringify(report)
                        },
                        {
                            filename: 'screenshot.png',
                            content: screenshot
                        }
                    ]
                };

                if (report.user) {
                    this.storage.users.get(report.user, (e, user) => {
                        if (!e && user) {
                            mailOpts.markdown += '\n\nReporter\'s email: ' + user.email;
                        }
                        mailer.sendMail(mailOpts);
                        this._logger.info('Bug report has been sent to ' + process.env.MAINTAINER_EMAIL);
                    });
                } else {
                    mailer.sendMail(mailOpts);
                    this._logger.info('Bug report has been sent to ' + process.env.MAINTAINER_EMAIL);
                }
            } else {
                this._logger.warn('No maintainer email set! Bug reports will ' +
                    'not be recorded until MAINTAINER_EMAIL is set in the env!');
            }
            return res.sendStatus(200);
        }
    }
].concat(resourcePaths);
