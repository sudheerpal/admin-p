const { v4: uuidv4 } = require('uuid');

const { SCOPE_ADMIN } = require('../../proto/scopes');
const { prefixed } = require('../../proto/collections');
const { dbg } = require('../utils/debug-service');
const {
    success,
    error,
    funcSessionAsync,
    funcScopedAsync,
} = require('../utils/control-service');


const mongoService = require("../db/mongo-service");

const mentionedCollections = (process.env.MONGO_MENTIONED_COLLECTIONS || 'users').split(',');
const readOnlyCollections = (process.env.MONGO_FINDONLY_COLLECTIONS || 'users').split(',');

function isMentioned(collection) {
    return process.env.MONGO_ONLY_MENTIONED ? mentionedCollections.indexOf(collection) >= 0 : true;
}

function isReadOnly(collection) {
    return readOnlyCollections.indexOf(collection) >= 0;
}

async function saveAsync(request, fromService) {

    let collection = fromService ? request.body.collection : prefixed(request.body.collection);

    if (!isMentioned(collection))
        return error('invalid collection', collection);

    if (!request.body.item)
        return error('missing data item');

    let index = request.body.index || { uuid: uuidv4() };

    let result = await mongoService.insertOrUpdateAsync(
        collection,
        index,
        { $set: request.body.item },
        request.body.options || { upsert: true }
    );

    if (result && index.uuid)
        result.uuid = index.uuid;

    if (result && index.metadata && index.metadata.uuid)
        result.uuid = index.metadata.uuid;

    return success('save done', result);
}

async function deleteAsync(request, fromService) {

    let collection = fromService ? request.body.collection : prefixed(request.body.collection);

    if (!isMentioned(collection))
        return error('invalid collection', collection);

    if (!request.body.filter || request.body.filter == {})
        return error('invalid delete filter');

    let result = await mongoService.deleteAsync(collection, request.body.filter || {});

    return success('delete done', result);
}

async function findAsync(request, fromService) {

    let collection = fromService ? String(request.body.collection) : prefixed(request.body.collection);

    if (!isReadOnly(collection))
        return error('invalid collection', collection);

    request.body.filter = request.body.filter || {};

    let limit = request.body.pageSize ? parseInt(request.body.pageSize) : undefined;
    let skip = request.body.page ? parseInt(request.body.page - 1) * limit : undefined;

    let result = await mongoService.findArrayAsync(collection,
        request.body.filter,
        request.body.sort,
        skip,
        limit,
        request.body.fields);

    let response = success('find done', result);

    if (request.body.page && request.body.pageSize) {
        let count = await mongoService.countAsync(collection, request.body.filter);
        response.page = request.body.page;
        response.pageSize = request.body.pageSize;
        response.foundCount = result.length;
        response.totalCount = count;
        response.nextPage = ((response.page - 1) * response.pageSize + response.foundCount) < response.totalCount;
    }

    return response;
}

async function findOneAsync(request, fromService) {

    let collection = fromService ? request.body.collection : prefixed(request.body.collection);

    if (!isReadOnly(collection))
        return error('invalid collection', collection);

    if (!request.body.filter || request.body.filter == {})
        return error('invalid filter');

    let result = await mongoService.findOneAsync(collection,
        request.body.filter,
        request.body.sort,
        request.body.skip,
        request.body.limit,
        request.body.fields);

    return success('find done', result);
}

function init(fastify) {

    dbg('init: data-service');

    if (process.env.ENABLE_DATA_API) {
        dbg('init: data-service-api: on');
        fastify.post('/data/save', funcScopedAsync(saveAsync, SCOPE_ADMIN));
        fastify.post('/data/delete', funcScopedAsync(deleteAsync, SCOPE_ADMIN));
        fastify.post('/data/find', funcSessionAsync(findAsync));
        fastify.post('/data/findOne', funcSessionAsync(findOneAsync));
    } else {
        dbg('init: data-service-api: off');
    }
}

module.exports = {
    init,
    saveAsync: async (params) => await saveAsync({ body: params }, true),
    deleteAsync: async (params) => await deleteAsync({ body: params }, true),
    findAsync: async (params) => await findAsync({ body: params }, true),
    findOneAsync: async (params) => await findOneAsync({ body: params }, true)
};