const mongoService = require("../db/mongo-service");


const { dbg } = require('../utils/debug-service');
const { SCOPE_VENDOR, SCOPE_ADMIN } = require('../../proto/scopes');

const {
    success,
    error,
    funcScopedAsync,
    hasScope,
} = require('../utils/control-service');

const { COLLECTION_STORES, COLLECTION_BRANCHES, COLLECTION_PRODUCTS, COLLECTION_CLASSES } = require("../../proto/collections");
const { saveAsync } = require("./data-service");
const { fsPutImageAsync, fsDelImageAsync } = require("../db/mongo-service");

async function vendorStoreSaveAsync(request) {

    let params = {
        "collection": request.body.type == 'class' ? COLLECTION_CLASSES : COLLECTION_STORES,
        "item": {
            "name": String(request.body.name).toLowerCase(),
            "vendor": request.user.username,
        }
    };

    if (request.body.title)
        params.item.title = String(request.body.title);
    if (request.body.title_ar)
        params.item.title_ar = String(request.body.title_ar);
    if (request.body.description)
        params.item.description = String(request.body.description);
    if (request.body.description_ar)
        params.item.description_ar = String(request.body.description_ar);

    if (request.body.email)
        params.item.email = String(request.body.email);
    if (request.body.phone)
        params.item.phone = String(request.body.phone);
    if (request.body.streakDiscount)
        params.item.streakDiscount = String(request.body.streakDiscount);

    if (!request.body.name || String(request.body.name).length <= 1) {
        return error('invalid store name');
    }

    let store = await mongoService.findOneAsync(COLLECTION_STORES, {
        name: String(request.body.name)
    });

    if (store && store.vendor != request.user.username) {
        return error('forbidden, already reserved');
    }
    if (!store)
        params.item.enabled = true;
    if (request.body.enabled)
        params.item.enabled = String(request.body.enabled) == "true";

    params.item.modifiedAt = Date.now();

    params.index = {
        "name": request.body.name.toLowerCase()
    };

    if (request.body.image) {
        params.item.image = `store-image-${params.item.name}`;
        await fsDelImageAsync(params.item.image);
        await fsPutImageAsync(params.item.image, String(request.body.image));
    }

    let saved = await saveAsync(params);

    if (saved.success) {
        return success('store/class saved');
    } else {
        return error('error saving store');
    }
}

async function vendorClassSaveAsync(request) {
    request.body.type = 'class';
    let result = await vendorStoreSaveAsync(request);
    return result;
}

async function vendorBranchSaveAsync(request) {

    if (!request.body.name)
        return error("invalid store branch");

    let storeName = String(request.body.store).toLowerCase().trim();
    let className = String(request.body.class).toLowerCase().trim();
    let branchName = String(request.body.name).toLowerCase().trim();

    let store = await mongoService.findOneAsync(request.body.type == 'class' ? COLLECTION_CLASSES : COLLECTION_STORES, {
        name: storeName
    });

    if (!store)
        return error('store/class not found');

    if (store && store.vendor != request.user.username) {
        return error('forbidden, not owned - store/class');
    }

    let filter = {
        name: branchName
    };

    if (request.body.type == 'class') {
        filter.class = className;
    } else {
        filter.store = storeName;
    }

    let branch = await mongoService.findOneAsync(COLLECTION_BRANCHES, filter);
    if (branch && branch.vendor != request.user.username) {
        return error('forbidden, not owned - branch');
    }

    let params = {
        "collection": COLLECTION_BRANCHES,
        "item": {
            "vendor": request.user.username,
            "name": branchName
        }
    };

    params.item.modifiedAt = Date.now();

    if (request.body.type == 'class') {
        params.item.type = 'class';
        params.item.class = className;
    } else {
        params.item.type = 'store';
        params.item.store = storeName;
    }

    if (!branch)
        params.item.enabled = true;
    if (request.body.enabled)
        params.item.enabled = String(request.body.enabled) == "true";

    if (request.body.title)
        params.item.title = String(request.body.title);
    if (request.body.title_ar)
        params.item.title = String(request.body.title_ar);
    if (request.body.description)
        params.item.description = String(request.body.description);
    if (request.body.description_ar)
        params.item.description_ar = String(request.body.description_ar);
    if (request.body.image)
        params.item.image = String(request.body.image);
    if (request.body.email)
        params.item.email = String(request.body.email);
    if (request.body.phone)
        params.item.phone = String(request.body.phone);
    if (request.body.mapURL)
        params.item.address = String(request.body.address);
    if (request.body.address)
        params.item.mapURL = String(request.body.mapURL);

    if (request.body.discount) {
        if (isNaN(request.body.discount) || request.body.discount <= 0 || request.body.discount > 100)
            return error('invalid discount', request.body.discount);
        params.item.discount = request.body.discount;
    }

    if (request.body.streakDiscount)
        params.item.streakDiscount = String(request.body.streakDiscount);

    if (request.body.longitude && request.body.latitude) {
        let lat = Number(request.body.latitude);
        let lng = Number(request.body.longitude);
        if (isNaN(lng) || isNaN(lat))
            return error('invalid coordinates');

        params.item.location = {
            type: "Point",
            coordinates: [lng, lat]
        };
    }

    params.index = {
        vendor: request.user.username,
        store: storeName,
        name: branchName
    };

    let saved = await saveAsync(params);
    if (saved.success) {
        return success('branch saved', saved.success.data);
    } else {
        return error('error saving branch');
    }
}

async function vendorClassDisableAsync(request) {
    request.body.type = 'class';
    let result = await vendorStoreDisableAsync(request);
    return result;
}

async function vendorStoreDisableAsync(request) {
    if (!request.body.store && !request.body.class)
        return error("invalid store/class branch");

    let storeName = String(request.body.store).toLowerCase().trim();
    let className = String(request.body.class).toLowerCase().trim();
    let enabled = String(request.body.enabled) == "true";

    let isAdmin = hasScope(request.user.scopes, [SCOPE_ADMIN]);
    if (request.body.type == 'class') {
        let _class = await mongoService.findOneAsync(COLLECTION_CLASSES, {
            name: className
        });
        if (!_class)
            return error('class not found');
        if (_class && _class.vendor != request.user.username) {
            return error('forbidden, not owned - class');
        }
    } else {
        let store = await mongoService.findOneAsync(COLLECTION_STORES, {
            name: storeName
        });
        if (!store)
            return error('store not found');
        if (store && !isAdmin && store.vendor != request.user.username) {
            return error('forbidden, not owned - store');
        }
    }

    let params = {
        "collection": request.body.type == 'class' ? COLLECTION_CLASSES : COLLECTION_STORES,
        "item": {
            enabled
        }
    };
    params.item.modifiedAt = Date.now();

    let vendor = isAdmin ? request.body.vendor : request.user.username;

    if (!vendor)
        return error('missing vendor', { vendor });

    params.index = {
        vendor,
        name: request.body.type == 'class' ? className : storeName
    };

    return await saveAsync(params);
}

async function vendorBranchDisableAsync(request) {

    if (!request.body.store || !request.body.name)
        return error("invalid store branch");

    let storeName = String(request.body.store).toLowerCase().trim();
    let branchName = String(request.body.name).toLowerCase().trim();
    let enabled = String(request.body.enabled) == "true";

    let isAdmin = hasScope(request.user.scopes, [SCOPE_ADMIN]);
    let store = await mongoService.findOneAsync(COLLECTION_STORES, {
        name: storeName
    });

    if (!store)
        return error('store not found');

    if (store && !isAdmin && store.vendor != request.user.username) {
        return error('forbidden, not owned - store');
    }

    let branch = await mongoService.findOneAsync(COLLECTION_BRANCHES, {
        store: storeName,
        name: branchName
    });

    if (!branch)
        return error('branch not found');

    if (branch && !isAdmin && branch.vendor != request.user.username) {
        return error('forbidden, not owned - branch');
    }

    let params = {
        "collection": COLLECTION_BRANCHES,
        "item": {
            enabled
        }
    };
    params.item.modifiedAt = Date.now();


    let vendor = isAdmin ? request.body.vendor : request.user.username;
    if (!vendor)
        return error('missing vendor', { vendor });

    params.index = {
        vendor,
        store: storeName,
        name: branchName
    };

    return await saveAsync(params);
}

async function vendorBranchProductSaveAsync(request) {

    if (!request.body.store || !request.body.branch || !request.body.name)
        return error("invalid store branch product");

    let storeName = String(request.body.store).toLowerCase().trim();
    let branchName = String(request.body.branch).toLowerCase().trim();
    let productName = String(request.body.name).toLowerCase().trim();

    let store = await mongoService.findOneAsync(COLLECTION_STORES, {
        name: storeName
    });

    if (!store)
        return error('store not found');

    if (store && store.vendor != request.user.username) {
        return error('forbidden, not owned - store');
    }

    let branch = await mongoService.findOneAsync(COLLECTION_BRANCHES, {
        store: storeName,
        name: branchName
    });

    if (!branch)
        return error('branch not found');

    if (branch && branch.vendor != request.user.username) {
        return error('forbidden, not owned - branch');
    }

    let product = await mongoService.findOneAsync(COLLECTION_PRODUCTS, {
        store: storeName,
        branch: branchName,
        name: productName
    });

    if (product && product.vendor != request.user.username) {
        return error('forbidden, not owned - product branch vendor');
    }

    let params = {
        "collection": COLLECTION_PRODUCTS,
        "item": {
            "vendor": request.user.username,
            "store": storeName,
            "branch": branchName,
            "name": productName
        }
    };
    params.item.modifiedAt = Date.now();

    if (!product)
        params.item.enabled = true;
    if (request.body.enabled)
        params.item.enabled = String(request.body.enabled) == "true";
    if (request.body.title)
        params.item.title = request.body.title;
    if (request.body.title_ar)
        params.item.title_ar = request.body.title_ar;
    if (request.body.description)
        params.item.description = request.body.description;
    if (request.body.description_ar)
        params.item.description_ar = request.body.description_ar;
    if (request.body.image)
        params.item.image = request.body.image;
    if (request.body.discount) {
        if (isNaN(request.body.discount) || request.body.discount <= 0 || request.body.discount > 100)
            return error('invalid discount', request.body.discount);
        params.item.discount = request.body.discount;
    }
    let productOptions = [];
    if (request.body.options) {
        let productOption = {};
        let options = request.body.options;
        let tags = {};
        for (const option of options) {
            // option tag check
            if (!option.tag)
                return error('invalid option, no tag');
            // dup tags check
            if (tags[option.tag])
                return error('invalid option, duplicate tag', option.tag);
            tags[option.tag] = 1;
            productOption.tag = option.tag;
            productOption.values = [];
            // option values check
            if (!option.values || !Array.isArray(option.values)) {
                return error('invalid option values', option.values);
            } else for (const value of option.values) {
                if (!value.title) {
                    return error('invalid option value', value);
                }
                value.description = value.description || '';
                value.price = value.price || 0;
                if (isNaN(value.price) || Number(value.price) < 0)
                    return error('invalid option value price', value.price);
                productOption.values.push({
                    title: value.title,
                    description: value.description,
                    price: value.price
                });
            }
            // type-check
            productOption.type = option.type;
            if (option.type == 'oneOf') {

            }
            else if (option.type == 'manyOf') {

            } else {
                return error('invalid option type', { allowed: ['oneOf', 'manyOf'] });
            }
            productOptions.push(productOption);
        }

        params.item.options = options;
    }

    params.index = {
        vendor: request.user.username,
        store: storeName,
        branch: branchName,
        name: productName
    };

    let saved = await saveAsync(params);
    if (saved.success) {
        return success('product saved', saved.success.data);
    } else {
        return error('error saving product');
    }
}

async function vendorBranchProductDisableAsync(request) {

    if (!request.body.store || !request.body.branch || !request.body.name)
        return error("invalid store branch product");

    let storeName = String(request.body.store).toLowerCase().trim();
    let branchName = String(request.body.branch).toLowerCase().trim();
    let productName = String(request.body.name).toLowerCase().trim();
    let isAdmin = hasScope(request.user.scopes, [SCOPE_ADMIN]);
    let enabled = String(request.body.enabled) == "true";

    let store = await mongoService.findOneAsync(COLLECTION_STORES, {
        name: storeName
    });

    if (!store)
        return error('store not found');

    if (store && !isAdmin && store.vendor != request.user.username) {
        return error('forbidden, not owned - store');
    }

    let branch = await mongoService.findOneAsync(COLLECTION_BRANCHES, {
        store: storeName,
        name: branchName
    });

    if (!branch)
        return error('branch not found', {
            store: storeName,
            name: branchName
        });

    if (branch && !isAdmin && branch.vendor != request.user.username) {
        return error('forbidden, not owned - branch');
    }

    let product = await mongoService.findOneAsync(COLLECTION_PRODUCTS, {
        store: storeName,
        branch: branchName,
        name: productName
    });

    if (!product)
        return error('product not found');

    if (product && !isAdmin && product.vendor != request.user.username) {
        return error('forbidden, not owned - product branch vendor');
    }

    let params = {
        "collection": COLLECTION_PRODUCTS,
        "item": {
            enabled
        }
    };
    params.item.modifiedAt = Date.now();

    let vendor = isAdmin ? request.body.vendor : request.user.username;
    if (!vendor)
        return error('missing vendor', { vendor });

    params.index = {
        vendor,
        store: storeName,
        branch: branchName,
        name: productName
    };

    return await saveAsync(params);
}

function init(fastify) {

    dbg('init: vendor-service');

    fastify.post('/vendors/classes/save', funcScopedAsync(vendorClassSaveAsync, SCOPE_VENDOR));
    fastify.post('/vendors/classes/disable', funcScopedAsync(vendorClassDisableAsync, SCOPE_VENDOR, SCOPE_ADMIN));

    fastify.post('/vendors/stores/save', funcScopedAsync(vendorStoreSaveAsync, SCOPE_VENDOR));
    fastify.post('/vendors/stores/disable', funcScopedAsync(vendorStoreDisableAsync, SCOPE_VENDOR, SCOPE_ADMIN));

    fastify.post('/vendors/stores/branches/save', funcScopedAsync(vendorBranchSaveAsync, SCOPE_VENDOR));
    fastify.post('/vendors/stores/branches/disable', funcScopedAsync(vendorBranchDisableAsync, SCOPE_VENDOR, SCOPE_ADMIN));

    fastify.post('/vendors/stores/branches/products/save', funcScopedAsync(vendorBranchProductSaveAsync, SCOPE_VENDOR));
    fastify.post('/vendors/stores/branches/products/disable', funcScopedAsync(vendorBranchProductDisableAsync, SCOPE_VENDOR, SCOPE_ADMIN));
}

module.exports = {

    init
};