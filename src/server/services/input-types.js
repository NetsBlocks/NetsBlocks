// handles the incoming input arguments for the RPCs. Parses and validates the inputs based on the code docs for the functions
const _ = require('lodash');
const blocks2js = require('./blocks2js');
const Projects = require('../storage/projects');

const GENERIC_ERROR = new Error('');  // don't add to the error msg generated by rpc-manager

const NB_TYPES = {
    Array: 'List',
    Object: 'Structured Data',
    BoundedNumber: 'Number',
    BoundedString: 'Input',
};

// converts a javascript type name into netsblox type name
function getNBType(jsType) {
    return NB_TYPES[jsType] || jsType;
}

const types = {};

types.Number = input => {
    input = parseFloat(input);
    if (isNaN(input)) {
        throw GENERIC_ERROR;
    }
    return input;
};

types.BoundedNumber = (input, min, max) => {
    const number = types.Number(input);
    min = parseFloat(min);
    max = parseFloat(max);
    if (isNaN(max)) {  // only minimum specified
        if (number < min) {
            throw new Error(`Number must be greater than ${min}`);
        }
        return number;
    }

    if (isNaN(min)) {  // only maximum specified
        if (max < number) {
            throw new Error(`Number must be less than ${max}`);
        }
        return number;
    }

    if (number < min || max < number) {  // both min and max bounds
        throw new Error(`Number must be between ${min} and ${max}`);
    }
    return number;
};


types.BoundedString = (input, min, max) => {
    const inString = input.toString();

    min = parseInt(min);
    max = parseInt(max);

    if(max == min)
    {
        if (inString.length != min) {
            throw new Error(`Length must be ${min}`);
        }
        return inString;
    }

    if (isNaN(max)) {  // only minimum specified
        if (inString.length < min) {
            throw new Error(`Length must be greater than ${min}`);
        }
        return inString;
    }


    if (isNaN(min)) {  // only maximum specified
        if (max < inString.length) {
            throw new Error(`Length must be less than ${max}`);
        }
        return inString;
    }

    if (inString.length < min || max < inString.length) {  // both min and max bounds
        throw new Error(`Length must be between ${min} and ${max}`);
    }
    return inString;
};


types.Date = input => {
    input = new Date(input);
    if (isNaN(input.valueOf())) {
        throw GENERIC_ERROR;
    }
    return input;
};

types.Array = input => {
    if (!Array.isArray(input)) throw GENERIC_ERROR;
    return input;
};

types.Latitude = input => {
    input = parseFloat(input);
    if (isNaN(input)) {
        throw GENERIC_ERROR;
    } else if (input < -90 || input > 90) {
        throw new Error('Latitude must be between -90 and 90.');
    }
    return input;
};

types.Longitude = input => {
    input = parseFloat(input);
    if (isNaN(input)) {
        throw GENERIC_ERROR;
    } else if (input < -180 || input > 180) {
        throw new Error('Longitude must be between -180 and 180.');
    }
    return input;
};

// all Object types are going to be structured data (simplified json for snap environment)
types.Object = input => {
    // check if it has the form of structured data
    let isArray = Array.isArray(input);
    if (!isArray || !input.every(pair => pair.length === 2 || pair.length === 1)) {
        throw new Error('It should be a list of (key, value) pairs.');
    }
    input = _.fromPairs(input);
    return input;
};

types.Function = async (blockXml, ctx) => {
    let roleName = '';
    let roleNames = [''];

    if (ctx) {
        const metadata = await Projects.getRawProjectById(ctx.caller.projectId);
        if (metadata) {
            roleNames = Object.values(metadata.roles)
                .map(role => role.ProjectName);
            roleName = metadata.roles[ctx.caller.roleId].ProjectName;
        }
    }

    let factory = blocks2js.compile(blockXml);
    let env = blocks2js.newContext();
    env.__start = function(project) {
        project.ctx = ctx;
        project.roleName = roleName;
        project.roleNames = roleNames;
    };
    const fn = await factory(env);
    const {doYield} = env;
    return function() {
        env.doYield = doYield.bind(null, Date.now());
        return fn.apply(this, arguments);
    };
};

types.Any = input => input;

module.exports = {
    parse: types,
    getNBType
};
