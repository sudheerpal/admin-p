
const { dbg } = require('../utils/debug-service');
const { SCOPE_ADMIN } = require('../../proto/scopes');

const {
    error,
    funcScopedAsync,
    funcAsync,
} = require('../utils/control-service');

const { COLLECTION_SLIDES } = require("../../proto/collections");
const { saveAsync, deleteAsync, findAsync, findOneAsync } = require("./data-service");

async function slideSaveAsync(request) {

    if (!request.body.name)
        return error('invalid slide name', request.body.name);

    if (!request.body.image)
        return error('invalid slide image', request.body.image);

    return await saveAsync({
        collection: COLLECTION_SLIDES,
        index: { name: String(request.body.name) },
        item: {
            image: String(request.body.image)
        }
    });
}

async function slideViewAsync(request) {
    let slideName = request.body.name;
    if (!slideName)
        return error('invalid slide name', slideName);
    return findOneAsync({
        collection: COLLECTION_SLIDES,
        filter: {
            name: slideName
        }
    });
}

async function slideDeleteAsync(request) {
    return deleteAsync({
        collection: COLLECTION_SLIDES,
        filter: {
            name: String(request.body.name)
        }
    });
}

async function slidesFindAsync(request) {
    return findAsync({
        collection: COLLECTION_SLIDES
    });
}

function init(fastify) {

    dbg('init: slides-service');

    fastify.post('/admin/slides/save', funcScopedAsync(slideSaveAsync, SCOPE_ADMIN));
    fastify.post('/admin/slides/view', funcScopedAsync(slideViewAsync, SCOPE_ADMIN));
    fastify.post('/admin/slides/delete', funcScopedAsync(slideDeleteAsync, SCOPE_ADMIN));

    fastify.post('/user/slides/find', funcAsync(slidesFindAsync));
}

module.exports = {
    init
};