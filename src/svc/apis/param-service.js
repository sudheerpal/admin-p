const mongoService = require("../db/mongo-service");

const COLLECTION_PARAMS = require("../../proto/collections").COLLECTION_PARAMS;

const {
    SCOPE_ADMIN
} = require("../../proto/scopes");

const types = require("../../proto/types");

const {
    error,
    success,
   funcScopedAsync
} = require("../utils/control-service");

const {
    dbg
} = require("../utils/debug-service");

async function getParamAsync(param, value) {

    let val = await mongoService.findOneAsync(COLLECTION_PARAMS, {
        param
    });

    let pname = param;
    let pval = val ? val.value : value;
    let ptyp = val ? val.type : types.DEFAULT;

    if (ptyp == types.NUMBER)
        pval = Number(pval);
    else if (ptyp == types.DATE)
        pval = new Date(pval);
    else if (ptyp == types.STRING)
        pval = String(pval);

    return {
        param: pname,
        value: pval,
        type: ptyp
    };
}

async function setParamAsync(param, value, type) {
    await mongoService.insertOrUpdateAsync(COLLECTION_PARAMS, {
        param
    }, {
        $set: {
            value: type == 'date' ? new Date(value) : type == 'number' ? Number(value) : String(value),
            type: type || types.DEFAULT
        }
    }, {
        upsert: true
    });
    return true;
}

async function findParamAsync(request) {
    if (!request.body.param)
        return error("invalid param");
    return success('fetched param', await getParamAsync(request.body.param));
}

async function saveParamAsync(request) {
    if (!request.body.param || !request.body.value)
        return error("invalid param/value");
    return success('param saved', {
        saved: await setParamAsync(request.body.param, request.body.value, request.body.type)
    });
}

module.exports = {

    init: (fastify) => {

        dbg('init: param-service');

        fastify.post('/param/get',funcScopedAsync(findParamAsync, SCOPE_ADMIN));
        fastify.post('/param/set',funcScopedAsync(saveParamAsync, SCOPE_ADMIN));

    },

    getParamAsync,
    setParamAsync
};