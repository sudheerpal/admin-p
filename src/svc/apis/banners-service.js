const mongoService = require("../db/mongo-service");


const { dbg } = require('../utils/debug-service');
const { SCOPE_ADMIN } = require('../../proto/scopes');

const {
    success,
    error,
    funcScopedAsync,
    funcAsync,
} = require('../utils/control-service');

const { COLLECTION_STORES, COLLECTION_BANNERS, COLLECTION_BRANCHES, COLLECTION_CLASSES, COLLECTION_PRODUCTS } = require("../../proto/collections");
const { saveAsync, deleteAsync, findAsync, findOneAsync } = require("./data-service");
const { fsGetImageAsync } = require("../db/mongo-service");

async function bannerSaveAsync(request) {
    if (!request.body.name)
        return error('invalid banner name', request.body.name);
    if (!request.body.title)
        return error('invalid banner title', request.body.title);
    let options = 0;
    if (request.body.stores) options++;
    if (request.body.products) options++;
    if (request.body.classes) options++;
    if (options != 1)
        return error('invalid banner items, only stores or products or classes');
    let banner = {
        name: String(request.body.name),
        title: String(request.body.title)
    };
    if (request.body.title_ar)
        banner.title_ar = String(request.body.title_ar);
    if (request.body.image)
        banner.image = String(request.body.image);
    if (request.body.stores) {
        if (!Array.isArray(request.body.stores))
            return error('invalid banner stores', request.body.stores);
        let stores = [];
        let storeNames = [...new Set(request.body.stores)];
        for (const storeName of storeNames) {
            let store = await mongoService.findOneAsync(COLLECTION_STORES, { name: String(storeName) });
            if (!store) {
                return error('invalid store', store);
            }
            stores.push(store);
        }
        banner.stores = stores;
    }
    if (request.body.branches) {
        if (!Array.isArray(request.body.branches))
            return error('invalid banner branches', request.body.branches);
        let branches = [];
        let branchNames = [...new Set(request.body.branches)];
        for (const branchName of branchNames) {
            let branch = await mongoService.findOneAsync(COLLECTION_BRANCHES, { name: String(branchName) });
            if (!branch) {
                return error('invalid branch', branch);
            }
            branches.push(branch);
        }
        banner.branches = branches;
    }
    if (request.body.products) {
        if (!Array.isArray(request.body.products))
            return error('invalid banner products', request.body.products);
        let products = [];
        let productsItems = [...new Set(request.body.products)];
        for (const productItem of productsItems) {
            let product = await mongoService.findOneAsync(COLLECTION_PRODUCTS, {
                store: String(productItem.store),
                branch: String(productItem.branch),
                name: String(productItem.name)
            });
            if (!product)
                return error('invalid product', productItem);
            products.push(product);
        }
        banner.products = products;
    }
    if (request.body.classes) {
        if (!Array.isArray(request.body.classes))
            return error('invalid banner classes', request.body.classes);
        let classes = [];
        let classNames = [...new Set(request.body.classes)];
        for (const className of classNames) {
            let _class = await mongoService.findOneAsync(COLLECTION_CLASSES, { name: String(className) });
            if (!_class) {
                return error('invalid class', className);
            }
            classes.push(_class);
        }
        banner.classes = classes;
    }
    return await saveAsync({
        collection: COLLECTION_BANNERS,
        index: { name: request.body.name },
        item: banner
    });
}

async function bannerViewAsync(request) {
    let bannerName = request.body.name;
    if (!bannerName)
        return error('invalid banner name', bannerName);
    return findOneAsync({
        collection: COLLECTION_BANNERS,
        filter: {
            name: bannerName
        }
    });
}

async function bannerDeleteAsync(request) {
    return deleteAsync({
        collection: COLLECTION_BANNERS,
        filter: {
            name: String(request.body.name)
        }
    });
}

async function bannersFindAsync(request) {
    if (request.body && request.body.like) {
        let stores = await findAsync({
            collection: COLLECTION_BANNERS,
            filter: {
                "stores.title": {
                    $regex: new RegExp(request.body.like, "i")
                }
            }
        });
        let classes = await findAsync({
            collection: COLLECTION_BANNERS,
            filter: {
                "classes.title": {
                    $regex: new RegExp(request.body.like, "i")
                }
            }
        });
        let products = await findAsync({
            collection: COLLECTION_BANNERS,
            filter: {
                "products.title": {
                    $regex: new RegExp(request.body.like, "i")
                }
            }
        });
        let branches = await findAsync({
            collection: COLLECTION_BANNERS,
            filter: {
                "branches.title": {
                    $regex: new RegExp(request.body.like, "i")
                }
            }
        });
        let data = [];
        for (const item of stores.success.data) {
            item.image = await fsGetImageAsync(`store-image-${item.name.toLowerCase()}`);
            data.push(item);
        }
        for (const item of classes.success.data)
            data.push(item);
        for (const item of products.success.data)
            data.push(item);
        for (const item of branches.success.data)
            data.push(item);
        return success("done", data);
    }
    let result = await findAsync({
        collection: COLLECTION_BANNERS
    });
    if (result && result.success && Array.isArray(result.success.data)) {
        for (const banner of result.success.data) {
            if (banner.stores) {
                for (const store of banner.stores) {
                    store.image = await fsGetImageAsync(`store-image-${store.name.toLowerCase()}`);
                }
            }
        }
    }
    return result;
}

function init(fastify) {
    dbg('init: banners-service');
    fastify.post('/admin/banners/save', funcScopedAsync(bannerSaveAsync, SCOPE_ADMIN));
    fastify.post('/admin/banners/view', funcScopedAsync(bannerViewAsync, SCOPE_ADMIN));
    fastify.post('/admin/banners/delete', funcScopedAsync(bannerDeleteAsync, SCOPE_ADMIN));
    fastify.post('/user/banners/find', funcAsync(bannersFindAsync));
}

module.exports = {
    init
};