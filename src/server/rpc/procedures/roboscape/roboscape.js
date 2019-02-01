/*
 * Author: Miklos Maroti <mmaroti@gmail.com>
 *
 * Robot to server messages:
 *  mac_addr[6] time[4] 'I': identification, sent every second
 *  mac_addr[6] time[4] 'S' left[2] right[2]: driving speed response
 *  mac_addr[6] time[4] 'B' msec[2] tone[2]: beep response
 *  mac_addr[6] time[4] 'W' bits[1]: whiskers status
 *  mac_addr[6] time[4] 'R' dist[2]: ultrasound ranging response
 *  mac_addr[6] time[4] 'T' left[4] right[4]: wheel ticks
 *  mac_addr[6] time[4] 'D' left[2] right[2]: drive distance
 *  mac_addr[6] time[4] 'P' status[1]: button pressed
 *  mac_addr[6] time[4] 'L' led[1] cmd[1]: LED state change
 *  mac_addr[6] time[4] 'F' bits[1]: infra red detection event
 *  mac_addr[6] time[4] 'G' msec[2] pwr[1]: send infra red light
 *
 * Server to robot messages:
 *  'S' left[2] right[2]: set driving speed
 *  'B' msec[2] tone[2]: beep
 *  'R': ultrasound ranging
 *  'T': get wheel ticks
 *  'D' left[2] right[2]: drive certain distance
 *  'L' led[1] state[1]: change LED state
 *  'G' msec[2] pwr[1]: send infra red light
 *
 * Environment variables:
 *  ROBOSCAPE_PORT: set it to the UDP port (1973) to enable this module
 *  ROBOSCAPE_MODE: sets the NetsBlox interface type, can be "security",
 *      "native" or "both" (default)
 */

'use strict';

const logger = require('../utils/logger')('roboscape');
const Robot = require('./robot');
var dgram = require('dgram'),
    server = dgram.createSocket('udp4'),
    ROBOSCAPE_MODE = process.env.ROBOSCAPE_MODE || 'both';

/*
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

// fetch the robot, create one if necessary
RoboScape.prototype._addRobot = function (mac_addr, ip4_addr, ip4_port) {
    var robot = this._robots[mac_addr];
    if (!robot) {
        logger.log('discovering ' + mac_addr + ' at ' + ip4_addr + ':' + ip4_port);
        robot = new Robot(mac_addr, ip4_addr, ip4_port, server);
        this._robots[mac_addr] = robot;
    } else {
        robot.updateAddress(ip4_addr, ip4_port);
    }
    return robot;
};

RoboScape.prototype._getRobot = function (robot) {
    robot = '' + robot;
    if(robot.length < 4) return undefined;
    if (robot.length === 12) {
        return RoboScape.prototype._robots[robot];
    }
    for (var mac_addr in RoboScape.prototype._robots) {
        if (mac_addr.endsWith(robot))
            return RoboScape.prototype._robots[mac_addr];
    }
};

RoboScape.prototype._heartbeat = function () {
    for (var mac_addr in RoboScape.prototype._robots) {
        var robot = RoboScape.prototype._robots[mac_addr];
        if (!robot.heartbeat()) {
            logger.log('forgetting ' + mac_addr);
            delete RoboScape.prototype._robots[mac_addr];
        }
    }
    setTimeout(RoboScape.prototype._heartbeat, 1000);
};

/**
 * Returns the MAC addresses of the registered robots for this client.
 * @returns {array} the list of registered robots
 */
RoboScape.prototype._getRegistered = function () {
    var state = this._state,
        robots = [];
    for (var mac_addr in state.registered) {
        if (this._robots[mac_addr].isMostlyAlive()) {
            robots.push(mac_addr);
        } else {
            delete state.registered[mac_addr];
        }
    }
    return robots;
};

/**
 * Registers for receiving messages from the given robots.
 * @param {array} robots one or a list of robots
 * @deprecated
 */
RoboScape.prototype.eavesdrop = function (robots) {
    return this.listen(robots);
};

/**
 * Registers for receiving messages from the given robots.
 * @param {array} robots one or a list of robots
 */
RoboScape.prototype.listen = function (robots) {
    var state = this._state,
        uuid = this.socket.uuid;

    for (var mac_addr in state.registered) {
        if (this._robots[mac_addr]) {
            this._robots[mac_addr].removeClientSocket(uuid);
        }
    }
    state.registered = {};

    if (!Array.isArray(robots)) {
        robots = ('' + robots).split(/[, ]/);
    }

    var ok = true;
    for (var i = 0; i < robots.length; i++) {
        var robot = this._getRobot(robots[i]);
        if (robot) {
            state.registered[robot.mac_addr] = robot;
            robot.addClientSocket(uuid);
        } else {
            ok = false;
        }
    }
    return ok;
};

/**
 * Returns the MAC addresses of all robots.
 * @returns {array}
 */
RoboScape.prototype.getRobots = function () {
    return Object.keys(RoboScape.prototype._robots);
};


RoboScape.prototype._tbd = function (fnName, args) {
    args = Array.from(args);
    let robotId = args.shift();
    const robot = this._getRobot(robotId);
    if (robot && robot.accepts(this.socket.uuid)) {
        console.log(`calling ${fnName} with "${args.join(', ')}"`);
        let rv = robot[fnName].apply(robot, args);
        if (rv === undefined) rv = true;
        return rv;
    }
    return false;
};

if (ROBOSCAPE_MODE === 'native' || ROBOSCAPE_MODE === 'both') {
    /**
     * Returns true if the given robot is alive, sent messages in the
     * last two seconds.
     * @param {string} robot name of the robot (matches at the end)
     * @returns {boolean} True if the robot is alive
     */
    RoboScape.prototype.isAlive = function (robot) {
        return this._tbd('isAlive', arguments);
    };

    /**
     * Sets the wheel speed of the given robots.
     * @param {string} robot name of the robot (matches at the end)
     * @param {number} left speed of the left wheel in [-128, 128]
     * @param {number} right speed of the right wheel in [-128, 128]
     * @returns {boolean} True if the robot was found
     */
    RoboScape.prototype.setSpeed = function (robot, left, right) {
        return this._tbd('setSpeed', arguments);
    };

    /**
     * Sets one of the LEDs of the given robots.
     * @param {string} robot name of the robot (matches at the end)
     * @param {number} led the number of the LED (0 or 1)
     * @param {number} command false/off/0, true/on/1, or toggle/2
     * @returns {boolean} True if the robot was found
     */
    RoboScape.prototype.setLed = function (robot, led, command) {
        return this._tbd('setLed', arguments);
    };

    /**
     * Beeps with the speaker.
     * @param {string} robot name of the robot (matches at the end)
     * @param {number} msec duration in milliseconds
     * @param {number} tone frequency of the beep in Hz
     * @returns {boolean} True if the robot was found
     */
    RoboScape.prototype.beep = function (robot, msec, tone) {
        return this._tbd('beep', arguments);
    };

    /**
     * Turns on the infra red LED.
     * @param {string} robot name of the robot (matches at the end)
     * @param {number} msec duration in milliseconds between 0 and 1000
     * @param {number} pwr power level between 0 and 100
     * @returns {boolean} True if the robot was found
     */
    RoboScape.prototype.infraLight = function (robot, msec, pwr) {
        return this._tbd('infraLight', arguments);
    };

    /**
     * Ranges with the ultrasound sensor
     * @param {string} robot name of the robot (matches at the end)
     * @returns {number} range in centimeters
     */
    RoboScape.prototype.getRange = function (robot) {
        return this._tbd('getRange', arguments);
    };

    /**
     * Returns the current number of wheel ticks (1/64th rotations)
     * @param {string} robot name of the robot (matches at the end)
     * @returns {array} the number of ticks for the left and right wheels
     */
    RoboScape.prototype.getTicks = function (robot) {
        return this._tbd('getTicks', arguments);
    };

    /**
     * Drives the whiles for the specified ticks.
     * @param {string} robot name of the robot (matches at the end)
     * @param {number} left distance for left wheel in ticks
     * @param {number} right distance for right wheel in ticks
     * @returns {boolean} True if the robot was found
     */
    RoboScape.prototype.drive = function (robot, left, right) {
        return this._tbd('drive', arguments);
    };

    /**
     * Sets the total message limit for the given robot.
     * @param {string} robot name of the robot (matches at the end)
     * @param {number} rate number of messages per seconds
     * @returns {boolean} True if the robot was found
     */
    RoboScape.prototype.setTotalRate = function (robot, rate) {
        return this._tbd('setTotalRate', arguments);
    };

    /**
     * Sets the client message limit and penalty for the given robot.
     * @param {string} robot name of the robot (matches at the end)
     * @param {number} rate number of messages per seconds
     * @param {number} penalty number seconds of penalty if rate is violated
     * @returns {boolean} True if the robot was found
     */
    RoboScape.prototype.setClientRate = function (robot, rate, penalty) {
        return this._tbd('setClientRate', arguments);
    };
}

if (ROBOSCAPE_MODE === 'security' || ROBOSCAPE_MODE === 'both') {
    /**
     * Sends a textual command to the robot
     * @param {string} robot name of the robot (matches at the end)
     * @param {string} command textual command
     * @returns {string} textual response
     */
    RoboScape.prototype.send = function (robot, command) {
        // logger.log('send ' + robot + ' ' + command);
        robot = this._getRobot(robot);

        if (!robot && typeof command !== 'string') return false;

        // figure out the raw command after processing special methods, encryption, seq and client rate
        if (command.match(/^backdoor[, ](.*)$/)) { // check if it is a backdoor
            logger.log('executing ' + command);
            command = RegExp.$1;
        } else { // if not a backdoor handle seq number and encryption
            // for replay attacks
            robot.commandToClient(command);

            command = robot.decrypt(command);

            var seqNum = -1;
            if (command.match(/^(\d+)[, ](.*)$/)) {
                seqNum = +RegExp.$1;
                command = RegExp.$2;
            }
            if (!robot.accepts(this.socket.uuid, seqNum)) {
                return false;
            }
        }

        robot.setSeqNum(seqNum);
        return robot.onCommand(command);
    };
}

server.on('listening', function () {
    var local = server.address();
    logger.log('listening on ' + local.address + ':' + local.port);
});

server.on('message', function (message, remote) {
    if (message.length < 6) {
        logger.log('invalid message ' + remote.address + ':' +
            remote.port + ' ' + message.toString('hex'));
    } else {
        var mac_addr = message.toString('hex', 0, 6); // pull out the mac address
        var robot = RoboScape.prototype._addRobot( // gets a robot instance
            mac_addr, remote.address, remote.port);
        robot.onMessage(message);
    }
});

/* eslint no-console: off */
if (process.env.ROBOSCAPE_PORT) {
    console.log('ROBOSCAPE_PORT is ' + process.env.ROBOSCAPE_PORT);
    server.bind(process.env.ROBOSCAPE_PORT || 1973);

    setTimeout(RoboScape.prototype._heartbeat, 1000);
}

RoboScape.isSupported = function () {
    if (!process.env.ROBOSCAPE_PORT) {
        console.log('ROBOSCAPE_PORT is not set (to 1973), RoboScape is disabled');
    }
    return !!process.env.ROBOSCAPE_PORT;
};

module.exports = RoboScape;
