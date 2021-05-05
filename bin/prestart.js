/* eslint-disable no-console */
'use strict';

const fsp = require('fs').promises;
const fse = require('fs-extra');
const path = require('path');
const srcPath = path.join(__dirname, '..', 'src', 'browser');
const {exec} = require('child_process');
const ServicesAPI = require('./../src/server/services/api');
const utils = require('./../src/server/api/cli/utils');

process.chdir(srcPath);
utils.runWithStorage(build).catch(err => console.error(err));

async function build() {
    await ServicesAPI.initialize(); // needed for docs
    await compileDocs();
}

async function hasDirectory(dir, subdir) {
    return (await fsp.readdir(dir)).includes(subdir) && (await fsp.lstat(path.join(dir, subdir))).isDirectory();
}

function isObject(type) {
    return type && type.name && type.name.toLowerCase() === 'object';
}
function getTypeString(type) {
    if (type.name === undefined || type.params === undefined) return type.toString();
    if (isObject(type)) return 'Object';
    return type.params.length ? `${type.name}<${type.params.map(getTypeString).join(', ')}>` : type.name;
}
function getParamString(param) {
    const str = param.type ? `${param.name}: ${getTypeString(param.type)}` : param.name;
    return param.optional ? `${str}?` : str;
}

const SERVICE_FILTERS = {
    all: () => true,
    nodeprecated: service => !service.tags.includes('deprecated'),
    fsonly: service => service.servicePath,
};
function getServiceFilter(filterString = 'fsonly,nodeprecated') {
    const filters = filterString.split(',').map(s => s.trim()).filter(s => s.length).map(s => SERVICE_FILTERS[s]);
    return s => filters.every(f => f(s));
}

const SERVICE_DIR_REGEX = /(.*)\/.*\.js/;
const DOCS_PATH = path.join(__dirname, '..', 'src', 'server', 'docs');
const GENERATED_PATH = path.join(DOCS_PATH, '_generated');
const SERVICES_PATH = path.join(GENERATED_PATH, 'services');

function getCategories(obj) {
    const cats = obj.categories;
    return cats && cats.length ? cats : ['index'];
}
function updateCategories(categories, name, obj) {
    for (const category of getCategories(obj)) {
        const cat = categories[category];
        if (cat) cat.items.push(name);
        else categories[category] = { description: undefined, items: [name] };
    }
}
function sortCategories(categories) {
    for (const category in categories) {
        categories[category].items.sort();
    }
}

function trimText(str) {
    str = (str || '').trim();
    return str.length ? str : undefined;
}

function getRPCsMeta(service) {
    const categories = { index: { description: undefined, items: [] } };
    const rpcs = {};

    for (const rpcName in service.rpcs) {
        const rpc = service.rpcs[rpcName];
        if (rpc.deprecated) continue;

        updateCategories(categories, rpcName, rpc);
        rpcs[rpcName] = {
            description: trimText(rpc.rawDescription),
            args: (rpc.args || []).map(arg => { return {
                decl: getParamString(arg),
                description: trimText(arg.rawDescription),
                fields: !isObject(arg.type) || !(arg.type.params || []).length ? undefined : arg.type.params.map(field => { return {
                    decl: getParamString(field),
                    description: trimText(field.rawDescription),
                }; }),
            }; }),
            returns: rpc.returns ? { type: getTypeString(rpc.returns.type), description: trimText(rpc.returns.rawDescription) } : undefined,
        };
    }
    sortCategories(categories);

    return { categories, rpcs };
}
function getMeta(serviceFilter) {
    const categories = { index: { description: undefined, items: [] } };
    const services = {};

    for (const serviceName in ServicesAPI.services.metadata) {
        const service = ServicesAPI.services.metadata[serviceName];
        if (!serviceFilter(service)) continue;

        updateCategories(categories, serviceName, service);
        services[serviceName] = {
            path: service.servicePath,
            description: trimText(service.rawDescription),
            rpcs: getRPCsMeta(service),
        };
    }
    sortCategories(categories);

    return { description: undefined, categories, services };
}

const NAME_REGEX = />>>NAME<<</g;
const DESC_REGEX = />>>DESC<<</g;
const RPCS_REGEX = />>>RPCS<<</g;
const CATS_REGEX = />>>CATS<<</g;
const SERV_REGEX = />>>SERV<<</g;

async function loadCategoryContent(rootPath, categoryName, isServiceCategory) {
    if ((await fsp.readdir(rootPath)).includes(`${categoryName}.rst`)) {
        return await fsp.readFile(path.join(rootPath, `${categoryName}.rst`), { encoding: 'utf8' });
    }
    const content = `>>>NAME<<<\n\n>>>DESC<<<\n>>>${isServiceCategory ? 'SERV' : 'RPCS'}<<<\n`;
    await fsp.writeFile(path.join(rootPath, `${categoryName}.rst`), content);
    return content;
}

async function copyServiceDocs(serviceName, service) {
    const indexContent = `>>>NAME<<<\n\n>>>DESC<<<\n\n>>>CATS<<<\n\n>>>RPCS<<<\n`;
    const dest = path.join(SERVICES_PATH, serviceName);

    let needsDir = true;
    if (service.path) {
        const serviceDir = service.path.match(SERVICE_DIR_REGEX)[1];
        if (await hasDirectory(serviceDir, 'docs')) {
            const src = path.join(serviceDir, 'docs');
            const [files,] = await Promise.all([fsp.readdir(src), fse.copy(src, dest)]);
            needsDir = false;
            if (files.includes('index.rst')) return;
        }
    }
    
    if (needsDir) await fsp.mkdir(dest);
    await fsp.writeFile(path.join(dest, 'index.rst'), indexContent);
}

function buildRPCString(serviceName, rpcName, rpc) {
    let str = `.. function:: ${serviceName}.${rpcName}(${rpc.args.map(x => x.decl).join(', ')})\n\n`;

    if (rpc.description) {
        str += `${rpc.description.split('\n').map(s => `    ${s}`).join('\n')}\n\n`;
    }

    if (rpc.args.length) {
        str += '    **Arguments:**\n\n';
        for (const arg of rpc.args) {
            const desc = arg.description ? ` - ${arg.description}` : '';
            str += `    - \`\`${arg.decl}\`\`${desc}\n`;
            if (!arg.fields) continue;

            str += '\n';
            for (const field of arg.fields) {
                const desc = field.description ? ` - ${field.description}` : '';
                str += `        - \`\`${field.decl}\`\`${desc}\n`;
            }
            str += '\n';
        }
        str += '\n';
    }

    if (rpc.returns) {
        const desc = rpc.returns.description ? ` - ${rpc.returns.description}` : '';
        str += `    **Returns:** \`\`${rpc.returns.type}\`\`${desc}\n\n`;
    }

    return str;
}

async function cleanCopy() {
    const docsFiles = new Set(await fsp.readdir(DOCS_PATH));
    if (docsFiles.has('_generated')) {
        await fsp.rmdir(GENERATED_PATH, { recursive: true });
        docsFiles.delete('_generated');
    }
    await fsp.mkdir(GENERATED_PATH);
    await fsp.mkdir(SERVICES_PATH);
    
    await Promise.all(Array.from(docsFiles).map(file => {
        return fse.copy(path.join(DOCS_PATH, file), path.join(GENERATED_PATH, file));
    }));
}
async function compileDocs() {
    const clean = cleanCopy();
    const serviceFilter = getServiceFilter(process.env.DOCS_SERVICE_FILTER);
    const meta = getMeta(serviceFilter);
    const servicesString = '.. toctree::\n    :maxdepth: 2\n    :titlesonly:\n    :caption: Services\n\n    '
        + (Object.keys(meta.categories).concat(meta.categories.index.items)).filter(s => s !== 'index').sort().map(item => {
            const isCategory = !!meta.categories[item];
            return isCategory ? `services/${item}.rst` : `services/${item}/index.rst`;
        }).join('\n    ');
    await clean;

    for (const serviceName in meta.services) {
        const service = meta.services[serviceName];
        await copyServiceDocs(serviceName, service);

        const categories = Object.keys(service.rpcs.categories).sort();
        const catsString = '.. toctree::\n    :maxdepth: 2\n    :titlesonly:\n    :caption: RPC Categories\n\n'
            + categories.filter(s => s !== 'index').map(s => `    ${s}.rst\n`).join('');
        for (const categoryName of categories) {
            const category = service.rpcs.categories[categoryName];
            const rpcsString = 'RPCS\n----\n\n' + category.items.map(s => buildRPCString(serviceName, s, service.rpcs.rpcs[s])).join('\n');
            const name = categoryName === 'index' ? serviceName : categoryName;

            let content = await loadCategoryContent(path.join(SERVICES_PATH, serviceName), categoryName, false);
            content = content.replace(NAME_REGEX, `${name}\n${'='.repeat(name.length)}\n\n`);
            content = content.replace(DESC_REGEX, (categoryName === 'index' ? service : category).description || '');
            content = content.replace(CATS_REGEX, catsString);
            content = content.replace(RPCS_REGEX, rpcsString);
            await fsp.writeFile(path.join(SERVICES_PATH, serviceName, `${categoryName}.rst`), content);
        }
    }

    for (const categoryName in meta.categories) {
        const category = meta.categories[categoryName];
        const servicePrefix = categoryName !== 'index' ? '' : 'services/';
        const itemRoot = categoryName !== 'index' ? SERVICES_PATH : GENERATED_PATH;
        const name = categoryName !== 'index' ? categoryName : 'NetsBlox';
        const servString = categoryName === 'index' ? servicesString : '.. toctree::\n    :maxdepth: 2\n    :titlesonly:\n    :caption: Services\n\n'
            + category.items.map(s => `    ${servicePrefix}${s}/index.rst\n`).join('');

        let content = await loadCategoryContent(itemRoot, categoryName, true);
        content = content.replace(NAME_REGEX, `${name}\n${'='.repeat(name.length)}\n\n`);
        content = content.replace(DESC_REGEX, (categoryName === 'index' ? meta : category).description || '');
        content = content.replace(SERV_REGEX, servString);
        await fsp.writeFile(path.join(itemRoot, `${categoryName}.rst`), content);
    }

    // the reason for not using promisify is so that we still get the stderr/stdout on failure so user can see what the issue was
    await new Promise((resolve, reject) => {
        exec('make clean && make html', { cwd: GENERATED_PATH }, async (error, stdout, stderr) => {
            if (error || stderr.length !== 0) {
                reject(Error(`failed to compile docs: error: ${error ? error : ''}, stderr: ${stderr}, stdout: ${stdout}`));
            }
            else if (!await hasDirectory(GENERATED_PATH, '_build')) {
                reject(Error(`failed to find docs build directory`));
            }
            else if (!await hasDirectory(path.join(GENERATED_PATH, '_build'), 'html')) {
                reject(Error(`failed to find html in docs build directory`));
            }
            else {
                console.log(`compiled docs:`, stdout);
                resolve();
            }
        });
    });
}

/* eslint-enable no-console */
