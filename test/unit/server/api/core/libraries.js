const utils = require('../../../../assets/utils');

describe(utils.suiteName(__filename), function() {
    const _ = require('lodash');
    const assert = require('assert').strict;
    const LibrariesAPI = utils.reqSrc('./api/core/libraries');
    const Errors = utils.reqSrc('./api/core/errors');

    const requestor = 'brian';
    const otherUser = 'hamid';

    beforeEach(() => utils.reset(true));

    describe('getLibrary', function() {
        const lib = {owner: requestor, name: 'testLib', blocks: 'test'};
        const publib = {
            owner: requestor,
            name: 'pubLib',
            blocks: 'otherBlocks',
            public: true,
        };
        beforeEach(() => utils.fixtures.libraries.seed(lib, publib));

        it('should get the library xml', async function() {
            const xml = await LibrariesAPI.getLibrary(lib.owner, lib.owner, lib.name);
            assert.equal(xml, lib.blocks);
        });

        it('should get other user public library', async function() {
            const xml = await LibrariesAPI.getLibrary(otherUser, publib.owner, publib.name);
            assert.equal(xml, publib.blocks);
        });

        it('should not get other user private library', async function() {
            await utils.shouldThrow(
                () => LibrariesAPI.getLibrary(otherUser, lib.owner, lib.name),
                Errors.Unauthorized
            );
        });
    });

    describe('getLibraries', function() {
        const libs = [
            {owner: requestor},
            {owner: otherUser},
        ];
        beforeEach(() => utils.fixtures.libraries.seed(...libs));

        it('should get a list of user libraries', async function() {
            const libraries = await LibrariesAPI.getLibraries(requestor, requestor);
            assert.equal(libraries.length, 1);
            assert.equal(libraries[0].owner, requestor);
        });

        it('should only include own libraries', async function() {
            const libraries = await LibrariesAPI.getLibraries(requestor, requestor);
            const otherLib = libraries.find(lib => lib.owner !== requestor);
            assert(!otherLib);
        });

        it('should not allow users to view another\'s libraries', async function() {
            await utils.shouldThrow(
                () => LibrariesAPI.getLibraries(requestor, otherUser),
                Errors.Unauthorized
            );
        });
    });

    describe('getPublicLibraries', function() {
        const libs = [
            {owner: requestor},
            {owner: otherUser},
            {owner: otherUser, public: true},
            {owner: requestor, public: true},
        ];
        let libraries;
        beforeEach(async () => {
            await utils.fixtures.libraries.seed(...libs);
            libraries = await LibrariesAPI.getPublicLibraries();
        });

        it('should get all public libraries', async function() {
            assert.equal(libraries.length, 2);
        });

        it('should not contain duplicates', async function() {
            assert.equal(_.uniq(libraries).length, libraries.length);
        });

        it('should only contain public libraries', async function() {
            const arePublic = libraries.every(lib => lib.public);
            assert(arePublic);
        });
    });

    describe('saveLibrary', function() {
        const libs = [
            {
                owner: requestor,
                name: 'testLib',
                blocks: 'test',
                public: true,
            },
        ];
        beforeEach(() => utils.fixtures.libraries.seed(...libs));

        it('should update library xml', async () => {
            await LibrariesAPI.saveLibrary(
                requestor,
                requestor,
                'testLib',
                'newXML',
                'some description',
            );
            const [lib] = await LibrariesAPI.getLibraries(requestor, requestor);
            assert.equal(lib.blocks, 'newXML');
        });

        it('should throw error if invalid name', async () => {
            await utils.shouldThrow(
                () => LibrariesAPI.saveLibrary(requestor, requestor, 'test@me',
                    'newXML', 'some description'),
                Errors.RequestError,
            );
        });

        it('should preserve library public state', async () => {
            await LibrariesAPI.saveLibrary(
                requestor,
                requestor,
                'testLib',
                'newXML',
                'some description',
            );
            const [lib] = await LibrariesAPI.getLibraries(requestor, requestor);
            assert(lib.public);
        });
    });

    describe('publishLibrary', function() {
        const lib = {
            owner: requestor,
            name: 'testlib',
        };
        const profaneCode = {
            owner: requestor,
            name: 'profane',
            blocks: '<comment>damn</comment>'
        };
        const profaneDesc = {
            owner: requestor,
            name: 'profaneDesc',
            description: 'asshole'
        };
        const profaneName = {
            owner: requestor,
            name: 'profaneName ass',
        };
        const runCustomJSLib = {
            owner: requestor,
            name: 'execJS',
            blocks: '<block s="reportJSFunction">'
        };

        beforeEach(() => utils.fixtures.libraries.seed(
            lib,
            profaneCode,
            profaneDesc,
            profaneName,
            runCustomJSLib,
        ));

        it('should set library to public', async () => {
            await LibrariesAPI.publishLibrary(
                lib.owner,
                lib.owner,
                lib.name,
            );

            const [newLib] = await LibrariesAPI.getLibraries(lib.owner, lib.owner);
            assert(newLib.public);
        });

        it('should require approval for profane names', async () => {
            const needsApproval = await LibrariesAPI.publishLibrary(
                profaneName.owner,
                profaneName.owner,
                profaneName.name,
            );

            assert(needsApproval);
        });

        it('should require approval for profane description', async () => {
            const needsApproval = await LibrariesAPI.publishLibrary(
                profaneDesc.owner,
                profaneDesc.owner,
                profaneDesc.name,
            );

            assert(needsApproval);
        });

        it('should require approval if profanity in code', async () => {
            const needsApproval = await LibrariesAPI.publishLibrary(
                profaneCode.owner,
                profaneCode.owner,
                profaneCode.name,
            );

            assert(needsApproval);
        });

        it('should require approval if exec JS in code', async () => {
            const needsApproval = await LibrariesAPI.publishLibrary(
                runCustomJSLib.owner,
                runCustomJSLib.owner,
                runCustomJSLib.name,
            );

            assert(needsApproval);
        });

        it('should throw error if library not found', async () => {
            await utils.shouldThrow(
                () => LibrariesAPI.publishLibrary(lib.owner, lib.owner, lib.name + 'fake'),
                Errors.LibraryNotFound
            );
        });
    });

    describe('unpublishLibrary', function() {
        const lib = {
            owner: requestor,
            name: 'testlib',
            public: true,
            needsApproval: true,
        };

        beforeEach(() => utils.fixtures.libraries.seed(lib));

        it('should set library "public" to false', async () => {
            await LibrariesAPI.unpublishLibrary(
                lib.owner,
                lib.owner,
                lib.name,
            );

            const [newLib] = await LibrariesAPI.getLibraries(lib.owner, lib.owner);
            assert(!newLib.public);
        });

        it('should set library "needsApproval" to false', async () => {
            await LibrariesAPI.unpublishLibrary(
                lib.owner,
                lib.owner,
                lib.name,
            );

            const [newLib] = await LibrariesAPI.getLibraries(lib.owner, lib.owner);
            assert(!newLib.needsApproval);
        });

        it('should throw error if library not found', async () => {
            await utils.shouldThrow(
                () => LibrariesAPI.unpublishLibrary(lib.owner, lib.owner, lib.name + 'fake'),
                Errors.LibraryNotFound
            );
        });
    });
});