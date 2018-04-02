/**
 * Author: Miklos Maroti <mmaroti@gmail.com>
 * 
 * Robot to server messages:
 *  mac_addr[6] time[4] 'I': identification, sent every second
 *  mac_addr[6] time[4] 'D' left[2] right[2]: driving speed response
 *  mac_addr[6] time[4] 'B' msec[2] tone[2]: beep response
 *  mac_addr[6] time[4] 'W' bits[1]: whiskers status
 *  mac_addr[6] time[4] 'R' dist[2]: ultrasound ranging response
 *  mac_addr[6] time[4] 'T' left[4] right[4]: wheel ticks
 *  mac_addr[6] time[4] 'X' left[2] right[2]: drive distance
 * 
 * Server to robot messages:
 *  'D' left[2] right[2]: set driving speed
 *  'B' msec[2] tone[2]: beep
 *  'R': ultrasound ranging
 *  'T': get wheel ticks
 *  'X' left[2] right[2]: drive certain distance
 * 
 * TODO:
 * - change 'D' to 'S', 'X' to 'D'
 * - move the message processing into the robot
 * - use promises instead of callbacks
 */

'use strict';

var debug = require('debug'),
    log = debug('netsblox:rpc:roboscape'),
    // log = console.log,
    dgram = require('dgram'),
    server = dgram.createSocket('udp4'),
    FORGET_TIME = 120, // forgetting a robot in seconds
    RESPONSE_TIMEOUT = 200; // waiting for response in milliseconds

var Robot = function (mac_addr, ip4_addr, ip4_port) {
    this.mac_addr = mac_addr;
    this.ip4_addr = ip4_addr;
    this.ip4_port = ip4_port;
    this.heartbeats = FORGET_TIME;
    this.timestamp = -1; // time of last message in robot time
    this.sockets = {}; // sockets of registered clients
    this.callbacks = {}; // callbacks keyed by msgType
};

Robot.prototype.updateAddress = function (ip4_addr, ip4_port) {
    this.ip4_addr = ip4_addr;
    this.ip4_port = ip4_port;
    this.heartbeats = FORGET_TIME;
};

Robot.prototype.heartbeat = function () {
    this.heartbeats -= 1;
    if (this.heartbeats <= 0) {
        this.sockets = null;
        return false;
    }
    return true;
};

Robot.prototype.sendToRobot = function (message) {
    server.send(message, this.ip4_port, this.ip4_addr, function (err) {
        if (err) {
            log('send error ' + err);
        }
    });
};

Robot.prototype.setSpeed = function (left, right) {
    left = Math.max(Math.min(+left, 128), -128);
    right = Math.max(Math.min(+right, 128), -128);

    log('set speed ' + this.mac_addr + ' ' + left + ' ' + right);
    var message = Buffer.alloc(5);
    message.write('D', 0, 1);
    message.writeInt16LE(left, 1);
    message.writeInt16LE(right, 3);
    this.sendToRobot(message);
};

Robot.prototype.beep = function (msec, tone) {
    msec = Math.min(Math.max(+msec, 0), 1000);
    tone = Math.min(Math.max(+tone, 0), 20000);

    log('set beep ' + this.mac_addr + ' ' + msec + ' ' + tone);
    var message = Buffer.alloc(5);
    message.write('B', 0, 1);
    message.writeUInt16LE(msec, 1);
    message.writeUInt16LE(tone, 3);
    this.sendToRobot(message);
};

Robot.prototype.addCallback = function (msgType, callback, timeout) {
    if (!this.callbacks[msgType]) {
        this.callbacks[msgType] = [];
    }
    var callbacks = this.callbacks[msgType];
    callbacks.push(callback);

    setTimeout(function () {
        var i = callbacks.indexOf(callback);
        if (i >= 0) {
            callbacks.splice(i, 1);
            callback(null);
        }
    }, timeout || RESPONSE_TIMEOUT);
};

Robot.prototype.getRange = function (callback) {
    this.addCallback('range', callback);
    log('range ' + this.mac_addr);
    var message = Buffer.alloc(1);
    message.write('R', 0, 1);
    this.sendToRobot(message);
};

Robot.prototype.getTicks = function (callback) {
    this.addCallback('ticks', callback);
    log('ticks ' + this.mac_addr);
    var message = Buffer.alloc(1);
    message.write('T', 0, 1);
    this.sendToRobot(message);
};

Robot.prototype.drive = function (left, right) {
    left = Math.max(Math.min(+left, 64), -64);
    right = Math.max(Math.min(+right, 64), -64);

    log('drive ' + this.mac_addr + ' ' + left + ' ' + right);
    var message = Buffer.alloc(5);
    message.write('X', 0, 1);
    message.writeInt16LE(left, 1);
    message.writeInt16LE(right, 3);
    this.sendToRobot(message);
};

Robot.prototype.report = function (msgType, content) {
    content.robot = this.mac_addr;
    content.time = this.timestamp;

    if (this.callbacks[msgType]) {
        var callbacks = this.callbacks[msgType];
        delete this.callbacks[msgType];
        callbacks.forEach(function (callback) {
            callback(content);
        });
        callbacks.length = 0;
    }

    for (var id in this.sockets) {
        var socket = this.sockets[id];
        log('sending ' + id + ' ' + msgType + ' ' + JSON.stringify(content));
        socket.send({
            type: 'message',
            dstId: socket.role,
            msgType: msgType,
            content: content
        });
    }
};

/**
 * RoboScape - This constructor is called on the first 
 * request to an RPC from a given room.
 * @constructor
 * @return {undefined}
 */
var RoboScape = function () {
    this._state = {
        registered: {}
    };
};

RoboScape.serviceName = 'RoboScape';
RoboScape.prototype._robots = {};

RoboScape.prototype._addRobot = function (mac_addr, ip4_addr, ip4_port) {
    var robot = this._robots[mac_addr];
    if (!robot) {
        log('discovering ' + mac_addr);
        robot = new Robot(mac_addr, ip4_addr, ip4_port);
        this._robots[mac_addr] = robot;
    } else {
        robot.updateAddress(ip4_addr, ip4_port);
    }
    return robot;
};

RoboScape.prototype._getRobot = function (robot) {
    if (typeof robot === 'string') {
        if (robot.length === 6) {
            return RoboScape.prototype._robots[robot];
        }
        for (var mac_addr in RoboScape.prototype._robots) {
            if (mac_addr.endsWith(robot))
                return RoboScape.prototype._robots[mac_addr];
        }
    }
    return undefined;
};

RoboScape.prototype._heartbeat = function () {
    for (var mac_addr in RoboScape.prototype._robots) {
        var robot = RoboScape.prototype._robots[mac_addr];
        if (!robot.heartbeat()) {
            log('forgetting ' + mac_addr);
            delete RoboScape.prototype._robots[mac_addr];
        }
    }
    setTimeout(RoboScape.prototype._heartbeat, 1000);
};

/**
 * Returns the MAC addresses of all robots.
 * @returns {array}
 */
RoboScape.prototype.getRobots = function () {
    return Object.keys(RoboScape.prototype._robots);
};

/**
 * Sets the wheel speed of the given robots.
 * @param {string} robot name of the robot (matches at the end)
 * @param {number} left speed of the left wheel in [-128, 128]
 * @param {number} right speed of the right wheel in [-128, 128]
 * @returns {boolean} True if the robot was found
 */
RoboScape.prototype.setSpeed = function (robot, left, right) {
    robot = this._getRobot(robot);
    if (robot) {
        robot.setSpeed(left, right);
        return true;
    }
    return false;
};

/**
 * Beeps with the speaker.
 * @param {string} robot name of the robot (matches at the end)
 * @param {number} msec duration in milliseconds
 * @param {number} tone frequency of the beep in Hz
 * @returns {boolean} True if the robot was found
 */
RoboScape.prototype.beep = function (robot, msec, tone) {
    robot = this._getRobot(robot);
    if (robot) {
        robot.beep(msec, tone);
        return true;
    }
    return false;
};

/**
 * Ranges with the ultrasound sensor
 * @param {string} robot name of the robot (matches at the end)
 * @returns {number} range in centimeters
 */
RoboScape.prototype.getRange = function (robot) {
    robot = this._getRobot(robot);
    if (robot) {
        var response = this.response;
        robot.getRange(function (content) {
            if (content) {
                response.status(200).json(content.range);
            } else {
                response.status(400).json(false);
            }
        });
        return null;
    }
    return false;
};

/**
 * Returns the current number of wheel ticks (1/64th rotations)
 * @param {string} robot name of the robot (matches at the end)
 * @returns {number} range in centimeters
 */
RoboScape.prototype.getTicks = function (robot) {
    robot = this._getRobot(robot);
    if (robot) {
        var response = this.response;
        robot.getTicks(function (content) {
            if (content) {
                response.status(200).json([content.left, content.right]);
            } else {
                response.status(400).json(false);
            }
        });
        return null;
    }
    return false;
};

/**
 * Drives the whiles for the specified ticks.
 * @param {string} robot name of the robot (matches at the end)
 * @param {number} left distance for left wheel in ticks
 * @param {number} right distance for right wheel in ticks
 * @returns {boolean} True if the robot was found
 */
RoboScape.prototype.drive = function (robot, left, right) {
    robot = this._getRobot(robot);
    if (robot) {
        robot.drive(left, right);
        return true;
    }
    return false;
};

/**
 * Returns the MAC addresses of the registered robots for this client.
 * @returns {array} the list of registered robots
 */
RoboScape.prototype._getRegistered = function () {
    var state = this._state,
        robots = [];
    for (var mac_addr in state.registered) {
        if (this._robots[mac_addr].sockets) {
            robots.push(mac_addr);
        } else {
            delete state.registered[mac_addr];
        }
    }
    return robots;
};

/**
 * Registers for receiving messages from the given robots.
 * @param {array} robot one or a list of robots
 */
RoboScape.prototype.register = function (robots) {
    var state = this._state,
        id = this.socket.uuid;

    for (var mac_addr in state.registered) {
        if (this._robots[mac_addr] && this._robots[mac_addr].sockets) {
            log('unregister ' + id + ' ' + mac_addr);
            delete this._robots[mac_addr].sockets[id];
        }
    }
    state.registered = {};

    if (!Array.isArray(robots)) {
        robots = ('' + robots).split(',');
    }

    var ok = true;
    for (var i = 0; i < robots.length; i++) {
        var robot = this._getRobot(robots[i]);
        if (robot) {
            log('register ' + id + ' ' + robot.mac_addr);
            state.registered[robot.mac_addr] = robot;
            this._robots[robot.mac_addr].sockets[id] = this.socket;
        } else {
            ok = false;
        }
    }
    return ok;
};

server.on('listening', function () {
    var local = server.address();
    log('listening on ' + local.address + ':' + local.port);
});

server.on('message', function (message, remote) {
    if (message.length < 11) {
        log('invalid ' + remote.address + ':' +
            remote.port + ' ' + message.toString('hex'));
        return;
    }

    var mac_addr = message.toString('hex', 0, 6),
        timestamp = message.readUInt32LE(6),
        command = message.toString('ascii', 10, 11);

    var robot = RoboScape.prototype._addRobot(mac_addr, remote.address, remote.port);
    robot.timestamp = timestamp;

    if (command === 'I' && message.length === 11) {
        // pass
    } else if (command === 'B' && message.length === 15) {
        robot.report('beep', {
            msec: message.readInt16LE(11),
            tone: message.readInt16LE(13),
        });
    } else if (command === 'D' && message.length === 15) {
        robot.report('speed', {
            left: message.readInt16LE(11),
            right: message.readInt16LE(13),
        });
    } else if (command === 'W' && message.length === 12) {
        robot.report('whiskers', {
            state: message.readUInt8(11),
        });
    } else if (command === 'R' && message.length === 13) {
        robot.report('range', {
            range: message.readInt16LE(11),
        });
    } else if (command === 'T' && message.length === 19) {
        robot.report('ticks', {
            left: message.readInt32LE(11),
            right: message.readInt32LE(15),
        });
    } else if (command === 'X' && message.length === 15) {
        robot.report('drive', {
            left: message.readInt16LE(11),
            right: message.readInt16LE(13),
        });
    } else {
        log('unknown ' + remote.address + ':' + remote.port +
            ' ' + message.toString('hex'));
    }
});

if (process.env.ROBOSCAPE_PORT) {
    console.log('ROBOSCAPE_PORT is ' + process.env.ROBOSCAPE_PORT);
    server.bind(process.env.ROBOSCAPE_PORT || 1973);

    setTimeout(RoboScape.prototype._heartbeat, 1000);
    module.exports = RoboScape;
} else {
    console.log('ROBOSCAPE_PORT is not set (to 1973), RoboScape is disabled');
}
