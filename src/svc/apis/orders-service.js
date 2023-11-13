const mongoService = require("../db/mongo-service");

const {
    COLLECTION_STORES,
    COLLECTION_BRANCHES,
    COLLECTION_PRODUCTS,
    COLLECTION_USERS_ORDERS,
    COLLECTION_STORES_ORDERS,
    COLLECTION_CLASSES,
    COLLECTION_USERS_STREAKS
} = require('../../proto/collections');

const { dbg } = require('../utils/debug-service');
const { SCOPE_CUSTOMER, SCOPE_VENDOR } = require('../../proto/scopes');

const streakService = require('./streak-service');

const {
    error,
    funcScopedAsync,
    success,
    getPagingParams,
} = require('../utils/control-service');

const {
    findAsync,
    findOneAsync,
    saveAsync,
    deleteAsync
} = require("./data-service");

const { randomUUID } = require("crypto");
const { broadcastAlertsAsync } = require("./notification-service");

async function saveOrderAsync(request) {

    if (request.body.class && request.body.store)
        return error('invalid order: only {class} or {store}');

    if (request.body.class) {

        let _class = await mongoService.findArrayAsync(COLLECTION_CLASSES, {
            name: String(request.body.class)
        });

        if (!_class)
            return error('invalid class order', request.body.class);

        let uuid = randomUUID();

        let result = await saveAsync({
            collection: COLLECTION_USERS_ORDERS,
            index: {
                requestedBy: request.user.username
            },
            item: {
                uuid,
                class: _class,
                vendor: _class.vendor,
                requestedBy: request.user.username,
                requestedAt: Date.now()
            }
        });

        if (result.success)
            result.success.data = { uuid };

        return result;

    } else {

        let storeName = String(request.body.store);
        let branchName = String(request.body.branch);
        let items = request.body.items;

        let store = await mongoService.findOneAsync(COLLECTION_STORES, { name: storeName });
        if (!store)
            return error('store not found', { storeName });

        let branch = await mongoService.findOneAsync(COLLECTION_BRANCHES, { name: branchName, store: storeName });
        if (!branch)
            return error('invalid item store-branch', { storeName, branchName });

        if (!items || !Array.isArray(items) || items.length == 0)
            return error('invalid order items', { items });

        let orderItems = [];

        for (const item of items) {
            let orderItem = {};
            if (item.product && !item.options)
                return error('invalid product needed item: {product,options}');
            let productName = String(item.product);
            orderItem.productName = productName;
            orderItem.quantity = item.quantity;
            let product = await mongoService.findOneAsync(COLLECTION_PRODUCTS, { name: productName, branch: branchName, store: storeName });
            if (!product)
                return error('invalid item store-branch-product', { name: productName, branch: branchName, store: storeName });
            if (!product.options || !Array.isArray(product.options) || product.options.length == 0)
                return error('invalid product options', product.options);
            if (!item.options || !Array.isArray(item.options) || item.options.length == 0)
                return error('invalid item options', item.options);
            if (!item.quantity || !Number.isInteger(item.quantity) || Number(item.quantity) <= 0)
                return error('invalid item quantity', item.quantity);

            if (product.image)
                orderItem.image = product.image;

            let tags = {};
            let orderOptions = [];
            for (const option of item.options) {
                if (!option.tag) return error('invalid option tag');
                if (tags[option.tag]) return error('duplicate tag', { tag: option.tag });
                for (const productOption of product.options) {
                    if (option.tag == productOption.tag) {
                        tags[option.tag] = 1;
                        if (productOption.type == 'oneOf') {
                            if (!option.selected || option.selected.length != 1) {
                                return error('invalid oneOf option selection', { itemOption: option, productOption });
                            } else {
                                let selected = option.selected[0];
                                let found = false;
                                for (const productValue of productOption.values) {
                                    if (productValue.title == selected.title && productValue.price == selected.price) {
                                        found = true;
                                    }
                                }
                                if (found) {
                                    orderOptions.push(option);
                                } else {
                                    return error('invalid options selected value', { itemOption: option, productOption });
                                }
                            }
                        }
                        if (productOption.type == 'manyOf') {
                            if (!option.selected || option.selected.length == 0) {
                                return error('invalid manyOf option selection', { itemOption: option, productOption });
                            } else {
                                for (const selected of option.selected) {
                                    let found = false;
                                    for (const productValue of productOption.values) {
                                        if (productValue.title == selected.title && productValue.price == selected.price) {
                                            found = true;
                                        }
                                    }
                                    if (found) {
                                        orderOptions.push(option);
                                    } else {
                                        return error('invalid options selected value', { itemOption: option, productOption });
                                    }
                                }
                            }
                        }
                    }
                }
                if (!tags[option.tag]) return error('option not found', { tag: option.tag });
            }

            orderItem.options = orderOptions;
            orderItems.push(orderItem);
        }

        // delete previous unconfirmed orders
        await deleteAsync({
            collection: COLLECTION_USERS_ORDERS,
            filter: {
                requestedBy: request.user.username
            }
        });

        // create the new unconfirmed order
        let uuid = randomUUID();

        let result = await saveAsync({
            collection: COLLECTION_USERS_ORDERS,
            index: {
                requestedBy: request.user.username
            },
            item: {
                uuid,
                store: storeName,
                vendor: store.vendor,
                branch: branchName,
                items: orderItems,
                requestedBy: request.user.username,
                requestedAt: Date.now()
            }
        });

        if (result.success)
            result.success.data = { uuid };

        return result;
    }
}

async function pendingOrderAsync(request) {
    return findOneAsync({
        collection: COLLECTION_USERS_ORDERS,
        filter: {
            requestedBy: request.user.username
        }
    });
}

async function confirmedOrdersAsync(request) {
    return findAsync({
        collection: COLLECTION_STORES_ORDERS,
        requestedBy: request.user.username
    });
}

async function confirmOrderAsync(request) {

    let storeOrder = await mongoService.findOneAsync(COLLECTION_STORES_ORDERS, { uuid: String(request.body.uuid) });
    if (storeOrder && storeOrder.confirmedBy)
        return error('already confirmed order', { uuid: request.body.uuid });

    let userOrder = await mongoService.findOneAsync(COLLECTION_USERS_ORDERS, { uuid: String(request.body.uuid) });
    if (!userOrder)
        return error('invalid user order', { uuid: request.body.uuid });

    if (userOrder.class) {

        let _class = await mongoService.findOneAsync(COLLECTION_CLASSES, {
            vendor: request.user.username,
            name: userOrder.class.name
        });

        if (!_class)
            return error('invalid order-vendor-class', { vendor: request.user.username, class: userOrder.class });

    } else {

        let store = await mongoService.findOneAsync(COLLECTION_STORES, {
            vendor: request.user.username,
            name: userOrder.store
        });

        if (!store)
            return error('invalid order-vendor-store', { vendor: userOrder.vendor, store: userOrder.store });

        if (store.streakDiscount)
            userOrder.storeStreakDiscount = store.streakDiscount;
    }

    let now = new Date();
    userOrder.confirmedBy = request.user.username;
    userOrder.confirmedAt = now.getTime();
    userOrder.scanDay = Number(now.yyyymmdd());
    userOrder.scannedUTC = now.toUTCString();

    // save also customer active streak at that time
    let result = await streakService.customerStreakAsync({
        user: {
            username: userOrder.requestedBy
        }
    });

    if (result && result.success && result.success.data && result.success.data.userStreak)
        userOrder.userStreak = result.success.data;

    // send after half hour by default 
    userOrder.notifyAt = Date.now() + (process.env.NOTIFY_ORDER_AFTER || 0.5 * 3600 * 1000);
    userOrder.notifyOk = -1;

    await saveAsync({
        collection: COLLECTION_STORES_ORDERS,
        index: {
            uuid: userOrder.uuid
        },
        item: userOrder
    });

    await deleteAsync({
        collection: COLLECTION_USERS_ORDERS,
        filter: {
            uuid: userOrder.uuid
        }
    });

    broadcastAlertsAsync({
        body: {
            usernames: [userOrder.requestedBy],
            alert: {
                notification: {
                    title: "order confirmed",
                    body: "order confirmed",
                    click_action: "ORDER_CONFIRMED"
                }
            }
        }
    });

    return success('order confirmed', userOrder);
}

async function notifyOrders() {
    let pendings = await mongoService.findArrayAsync(COLLECTION_STORES_ORDERS, { notifyOk: -1, notifyAt: { $lte: Date.now() } });
    for (const order of pendings) {
        broadcastAlertsAsync({
            body: {
                usernames: [order.requestedBy],
                alert: {
                    notification: {
                        title: "Rank Your Order",
                        body: order.uuid,
                        click_action: "RANK_ORDER"
                    }
                }
            }
        });
        await saveAsync({
            collection: COLLECTION_STORES_ORDERS,
            index: {
                uuid: order.uuid
            },
            item: {
                notifyOk: 1
            }
        });
    }
}

async function findOrdersAsync(request) {

    let filter = {
        confirmedBy: request.user.username
    };

    if (request.body.uuid)
        filter.uuid = request.body.uuid;
    if (request.body.branch)
        filter.branch = request.body.branch;
    if (request.body.requestedBy)
        filter.requestedBy = request.body.requestedBy;

    let sort = request.body.sort || { scannedUTC: -1 };

    let { page, pageSize } = getPagingParams(request);

    return await findAsync({
        collection: COLLECTION_STORES_ORDERS,
        filter,
        page,
        pageSize,
        sort
    });
}


function init(fastify) {

    dbg('init: orders-service');

    fastify.post('/orders/customer/request', funcScopedAsync(saveOrderAsync, SCOPE_CUSTOMER));
    fastify.post('/orders/customer/pending', funcScopedAsync(pendingOrderAsync, SCOPE_CUSTOMER));
    fastify.post('/orders/customer/confirmed', funcScopedAsync(confirmedOrdersAsync, SCOPE_CUSTOMER));

    fastify.post('/orders/vendors/confirm', funcScopedAsync(confirmOrderAsync, SCOPE_VENDOR));
    fastify.post('/orders/vendors/find', funcScopedAsync(findOrdersAsync, SCOPE_VENDOR));

    if (process.env.ORDER_RANK_NOTIFICATIONS_MS) {
        dbg('Users Orders notification alarm each', process.env.ORDER_RANK_NOTIFICATIONS_MS / 60000, 'minutes')
        notifyOrders();
        setInterval(notifyOrders, process.env.ORDER_RANK_NOTIFICATIONS_MS);
    } else {
        dbg('Users Orders notification alarm is off');
    }
}

module.exports = {
    init
};