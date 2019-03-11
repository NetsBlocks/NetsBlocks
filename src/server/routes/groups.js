// endpoints for managing groups
'use strict';

const Logger = require('../logger'),
    logger = new Logger('netsblox:api:Groups'),
    Users = require('../storage/users'),
    assert = require('assert'),
    Groups = require('../storage/groups');

module.exports = [
    {
        URL: 'groups',
        Method: 'GET',
        middleware: ['isLoggedIn'],
        Handler: async function(req) {
            // gets a list of groups
            let owner = req.session.username;
            let groups = await Groups.findAllUserGroups(owner);
            return groups.map(grp => grp.data());
        }
    },
    {
        // get group details, only the owner can
        // CHECK maybe the users want to see this too
        URL: 'groups/:id',
        Method: 'GET',
        middleware: ['isLoggedIn', 'isGroupOwner'],
        Handler: async function(req) {
            // a specific group's details: (which only include members)
            const groupId = req.params.id;
            let group = await Groups.get(groupId);
            return group.data();
        }
    },
    {
        // get group members
        URL: 'groups/:id/members',
        Method: 'GET',
        middleware: ['isLoggedIn', 'isGroupOwner'],
        Handler: async function(req) {
            // a specific group's details: (which only include members)
            const groupId = req.params.id;
            let users = await Users.findGroupMembers(groupId);
            return users.map(u => u.pretty());
        }
    },
    {
        URL: 'groups/:id',
        Method: 'PATCH',
        middleware: ['isLoggedIn', 'isGroupOwner'],
        Handler: async function(req) {
            const groupId = req.params.id;
            // create a new group
            let newGroupName = req.body.name;
            if (!newGroupName) throw new Error('updated group name is required');
            let owner = req.session.username;

            let existingGroup = await Groups.findOne(newGroupName, owner);
            if (existingGroup) throw new Error('group name exists');

            logger.info('updating group', newGroupName, '/', owner);
            let group = await Groups.get(groupId);
            group.name = newGroupName;
            await group.update();
            return group.data();
        }
    },
    {
        URL: 'groups',
        Method: 'POST',
        middleware: ['isLoggedIn'],
        Handler: async function(req) {
            // create a new group
            let groupName = req.body.name;
            if (!groupName) throw new Error('group name is required');
            let owner = req.session.username;
            logger.info('creating group', groupName, 'with owner', owner);

            let existingGroup = await Groups.findOne(groupName, owner);
            if (existingGroup) throw new Error('group name exists');

            let group = await Groups.new(groupName, owner);
            return group.data();
        }
    },
    {
        // create new members
        URL: 'groups/:id/members',
        Method: 'POST',
        middleware: ['isLoggedIn', 'isGroupOwner'],
        Handler: async (req) => {
            let username = req.body.username,
                password = req.body.password,
                email = req.body.email,
                groupId = req.params.id;
            let user = await Users.get(username);
            if (user) {
                throw new Error('user already exists');
            }
            user = Users.new(
                username,
                email,
                groupId,
                password,
            );
            let result = await user.save();
            if (result.upserted) {
                assert.deepEqual(result.upserted.length, 1, 'expected to affect one row');
                let _id = result.upserted[0]._id;
                return {username, email, groupId, _id};
            } else {
                throw new Error(`failed to create user ${username}`);
            }
        }
    },
    {
        // overwrites member info
        // does not allow group membership change
        URL: 'groups/:id/members/:userId',
        Method: 'PATCH',
        middleware: ['isLoggedIn', 'isGroupOwner', 'isValidMember', 'canManageMember'],
        Handler: async function(req) {
            let email = req.body.email,
                userId = req.params.userId;

            // we need atleast one field to patch
            if (!email) throw new Error('missing information');

            let user = await Users.getById(userId);
            user.email = email;
            await user.update();
            return `user saved ${user.username}`;
        }

    },
    {
        // delete a group member
        URL: 'groups/:id/members/:userId',
        Method: 'DELETE',
        middleware: ['isLoggedIn', 'isGroupOwner', 'isValidMember', 'canManageMember', 'memberIsNew'],
        Handler: async function(req) {
            let userId = req.params.userId;

            let user = await Users.getById(userId);
            await user.destroy();
            return `user deleted ${user.username}`;
        }

    },
    {
        URL: 'groups/:id',
        Method: 'DELETE',
        middleware: ['isLoggedIn', 'isGroupOwner'],
        Handler: async function(req) {
            let groupId = req.params.id;
            // delete a group
            let group = await Groups.get(groupId);
            if (await group.isNew()) {
                logger.info('removing group', group.name);
                await group.destroy();
                return `deleted group ${group.name}`;
            } else {
                throw new Error('cannot delete group.');
            }
        }
    },
].map(route => { // handle the actual sending of the results
    let handler = route.Handler;
    route.Handler = (req, res) => {
        handler(req, res)
            .then(val => {
                if (typeof val === 'object') {
                    res.status(200).json(val);
                } else {
                    res.status(200).send(val);
                }
            })
            .catch(e => {
                logger.error(e);
                // WARN could potentially leak information
                res.status(500).send(e.message);
            });
    };
    return route;
});
