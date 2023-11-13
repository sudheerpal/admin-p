const mongoService = require("../db/mongo-service");

const { COLLECTION_USERS, COLLECTION_CATEGORIES, COLLECTION_STORES, COLLECTION_BRANCHES, COLLECTION_PRODUCTS, COLLECTION_USERS_ORDERS, COLLECTION_STORES_ORDERS } = require('../../proto/collections');

const { dbg } = require('../utils/debug-service');
const { SCOPE_ADMIN } = require('../../proto/scopes');

const {
    success,
    error,
    funcScopedAsync,
    getPagingParams,
} = require('../utils/control-service');
const { VENDOR, CUSTOMER } = require("../../proto/types");
const { saveAsync, deleteAsync, findAsync } = require("./data-service");
const { fsGetImageAsync } = require("../db/mongo-service");


async function blockCustomerAsync(request) {

    let username = String(request.body.username).toLowerCase().trim();
    let blocked = String(request.body.block).toLowerCase() == "true";
    let user = await mongoService.findOneAsync(COLLECTION_USERS, {
        username,
        type: CUSTOMER
    });

    if (!user) {
        return error('invalid customer', { username });
    }

    await mongoService
        .insertOrUpdateAsync(COLLECTION_USERS, { username }, { $set: { blocked } }, { upsert: true });

    return success("user created, awaiting email validation", {
        username,
        email
    });
}

async function vendorEnableAsync(request) {

    let username = String(request.body.username).toLowerCase().trim();
    let enabled = String(request.body.enabled).toLowerCase() == "true";

    let user = await mongoService.findOneAsync(COLLECTION_USERS, {
        username,
        type: VENDOR
    });

    if (!user) {
        return error('invalid vendor', { username });
    }

    await mongoService
        .insertOrUpdateAsync(COLLECTION_USERS, { username }, { $set: { enabled } }, { upsert: true });

    return success("user enabled", {
        username
    });
}

async function categorySaveAsync(request) {

    let params = {
        "collection": COLLECTION_CATEGORIES,
        "item": {
            "name": String(request.body.name),
            "description": String(request.body.description),
            "description_ar": String(request.body.description_ar),
            "image": String(request.body.image)
        }
    };

    if (!request.body.name || String(request.body.name).length <= 1) {
        return error('invalid category');
    }

    if (request.body.uuid) {
        params.index = {
            "uuid": String(request.body.uuid)
        };
    } else {
        params.index = {
            "name": String(request.body.name)
        };
    }

    let saved = await saveAsync(params);
    if (saved.success) {
        return success('category saved');
    } else {
        return error('error saving the category');
    }
}
async function categoryDeleteAsync(request) {

    let params = {
        "collection": COLLECTION_CATEGORIES,
        "filter": {
            "name": String(request.body.name)
        }
    };

    let saved = await deleteAsync(params);
    if (saved.success) {
        return success('category deleted');
    } else {
        return error('error creating the category');
    }
}

async function usersListAsync(request) {
    let filter = {
        type: CUSTOMER
    };
    if (request.body.username)
        filter.username = String(request.body.username);

    if (request.body.blocked)
        filter.blocked = String(request.body.blocked) == "true";

    if (request.body.enabled)
        filter.enabled = String(request.body.enabled) == "true";


    let { page, pageSize } = getPagingParams(request);
    let sort = {
        username: 1
    };
    return await findAsync({
        collection: COLLECTION_USERS,
        filter,
        page,
        pageSize,
        sort,
        fields: {
            projection: {
                "_id": 0,
                "verification": 0,
                "password": 0
            }
        }
    });
}

async function storesListAsync(request) {
    let filter = {};
    if (request.body.vendor)
        filter.vendor = String(request.body.vendor);
    if (request.body.name)
        filter.name = String(request.body.name);
    if (request.body.enabled)
        filter.enabled = String(request.body.enabled) == "true";
    let { page, pageSize } = getPagingParams(request);
    let sort = {
        name: 1
    };

    let result = await findAsync({
        collection: COLLECTION_STORES,
        filter,
        page,
        pageSize,
        sort
    });

    let stores = result.success.data;
    for (const store of stores) {
        if (request.body.noImages) {
            delete store.image;
        } else {
            store.image = await fsGetImageAsync(`store-image-${store.name}`);
        }
    }

    return result;
}

async function branchesListAsync(request) {
    let filter = {};
    if (request.body.store)
        filter.store = String(request.body.store);
    if (request.body.vendor)
        filter.vendor = String(request.body.vendor);
    if (request.body.name)
        filter.name = String(request.body.name);
    if (request.body.enabled)
        filter.enabled = String(request.body.enabled) == "true";
    let { page, pageSize } = getPagingParams(request);
    let sort = {
        name: 1
    };

    let result = await findAsync({
        collection: COLLECTION_BRANCHES,
        filter,
        page,
        pageSize,
        sort
    });

    let branches = result.success.data;

    for (const branch of branches) {
        if (request.body.noImages) {
            delete branch.image;
        }
    }

    return result;
}

async function productsListAsync(request) {
    let filter = {};
    if (request.body.branch)
        filter.branch = String(request.body.branch);
    if (request.body.store)
        filter.vendor = String(request.body.store);
    if (request.body.vendor)
        filter.vendor = String(request.body.vendor);
    if (request.body.name)
        filter.name = String(request.body.name);
    if (request.body.enabled)
        filter.enabled = String(request.body.enabled) == "true";
    let { page, pageSize } = getPagingParams(request);
    let sort = {
        name: 1
    };
    let result = await findAsync({
        collection: COLLECTION_PRODUCTS,
        filter,
        page,
        pageSize,
        sort
    });
    for (const product of result.success.data)
        if (request.body.noImages)
            delete product.image;
    return result;
}

async function ordersListAsync(request) {

    let filter = {};

    if (request.body.branch)
        filter.branch = String(request.body.branch);

    if (request.body.store)
        filter.store = String(request.body.store);

    if (request.body.vendor)
        filter.vendor = String(request.body.vendor);

    if (request.body.scanDay)
        filter.scanDay = Number(request.body.scanDay);

    let { page, pageSize } = getPagingParams(request);

    let sort = {
        confirmedAt: -1
    };

    return await findAsync({
        collection: COLLECTION_STORES_ORDERS,
        filter,
        page,
        pageSize,
        sort
    });
}

async function vendorsListAsync(request) {
    let filter = {
        type: VENDOR
    };
    let { page, pageSize } = getPagingParams(request);
    let sort = {
        name: 1
    };
    if (request.body.username)
        filter.username = username;
    let result = await findAsync({
        collection: COLLECTION_USERS,
        filter,
        page,
        pageSize,
        sort,
        fields: {
            projection: {
                "_id": 0,
                "verification": 0,
                "password": 0
            }
        }
    });

    let vendors = result.success.data;

    for (const vendor of vendors) {
        if (request.body.noImages) {
            delete vendor.image;
        }
    }

    return result;
}


function init(fastify) {

    dbg('init: admin-service');

    fastify.post('/admin/vendor/enable', funcScopedAsync(vendorEnableAsync, SCOPE_ADMIN));
    fastify.post('/admin/customer/block', funcScopedAsync(blockCustomerAsync, SCOPE_ADMIN));

    fastify.post('/admin/categories/save', funcScopedAsync(categorySaveAsync, SCOPE_ADMIN));
    fastify.post('/admin/categories/delete', funcScopedAsync(categoryDeleteAsync, SCOPE_ADMIN));

    fastify.post('/admin/users/find', funcScopedAsync(usersListAsync, SCOPE_ADMIN));
    fastify.post('/admin/stores/find', funcScopedAsync(storesListAsync, SCOPE_ADMIN));
    fastify.post('/admin/branches/find', funcScopedAsync(branchesListAsync, SCOPE_ADMIN));
    fastify.post('/admin/products/find', funcScopedAsync(productsListAsync, SCOPE_ADMIN));
    fastify.post('/admin/vendors/find', funcScopedAsync(vendorsListAsync, SCOPE_ADMIN));
    fastify.post('/admin/orders/find', funcScopedAsync(ordersListAsync, SCOPE_ADMIN));
}

module.exports = {
    init
};