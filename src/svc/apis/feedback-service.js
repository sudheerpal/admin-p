const mongoService = require("../db/mongo-service");

const {
    COLLECTION_CATEGORIES,
    COLLECTION_STORES,
    COLLECTION_BRANCHES_CATEGORIES,
    COLLECTION_BRANCHES_RANKS,
    COLLECTION_BRANCHES
} = require('../../proto/collections');

const { dbg } = require('../utils/debug-service');
const { SCOPE_CUSTOMER, SCOPE_ADMIN } = require('../../proto/scopes');

const {
    error,
    funcScopedAsync,
    success,
    funcAsync,
} = require('../utils/control-service');

const { saveAsync } = require("./data-service");

async function feedbackApplyAsync(request) {

    if (!request.body.category && !request.body.store && !request.body.branch)
        return error('missing data, needed {category, store, branch}');

    let storeName = String(request.body.store).toLowerCase().trim();
    let branchName = String(request.body.branch).toLowerCase().trim();
    let categoryName = String(request.body.category).toLowerCase().trim();

    let category = await mongoService.findOneAsync(COLLECTION_CATEGORIES, {
        name: categoryName
    });

    if (!category)
        return error('invalid category', categoryName);

    let store = await mongoService.findOneAsync(COLLECTION_STORES, {
        name: storeName
    });

    if (!store)
        return error('invalid store', storeName);

    let branch = await mongoService.findOneAsync(COLLECTION_BRANCHES, {
        name: branchName
    });

    if (!branch)
        return error('invalid branch', branchName);

    let result = await saveAsync({
        collection: COLLECTION_BRANCHES_CATEGORIES,
        index: {
            store: storeName,
            branch: branchName,
            username: request.user.username
        },
        item: {
            category: categoryName
        }
    });

    let rank = Number(request.body.rank);
    if (Number.isInteger(rank) && rank > 0 & rank < 6) {
        let comment = String(request.body.comment || '');
        await saveAsync({
            collection: COLLECTION_BRANCHES_RANKS,
            index: {
                store: storeName,
                branch: branchName,
                username: request.user.username
            },
            item: {
                rank,
                comment,
                rankedAt: new Date().getTime(),
                rankedAtUTC: new Date().toUTCString()
            }
        });
    }

    result = await mongoService.aggregateAsync(COLLECTION_BRANCHES_CATEGORIES, [
        {
            $match: { store: storeName, branch: branchName }
        },
        {
            $group: {
                _id: "$category",
                count: { $sum: 1 }
            }
        },
        {
            $sort: { count: -1 }
        },
        {
            $limit: 1
        }
    ]);

    let fb = await feedbackListAsync({ body: { store: storeName, branch: branchName } });
    if (fb.success && fb.success.data) {
        let feedback = fb.success.data;
        result[0].feedback = feedback;
    }

    let categoryFeedback = {
        category: result[0]._id,
        feedback: result[0].feedback
    };

    await saveAsync({
        collection: COLLECTION_BRANCHES,
        index: {
            name: branchName,
            store: storeName
        },
        item: categoryFeedback
    });

    return success("done", categoryFeedback);
}

async function feedbackListAsync(request) {

    let storeName = String(request.body.store);
    let branchName = String(request.body.branch);

    let feedbacks = await mongoService.findArrayAsync(COLLECTION_BRANCHES_RANKS, { store: storeName, branch: branchName });

    if (feedbacks.length == 0)
        return success('no feedback data yet', { rank: -1 });

    let rank = 0;
    let feedback = {};
    let users = {};
    let uniqueUsers = 0;

    let items = feedbacks.map(fb => {
        rank += fb.rank;
        delete fb.store;
        if (!users[fb.username]) {
            users[fb.username] = 1;
            uniqueUsers += 1;
        }
        return fb;
    });

    feedback.rank = rank / feedbacks.length;
    feedback.totalCount = feedbacks.length;
    feedback.uniqueUsers = uniqueUsers;

    if (String(request.body.withComments) == "true")
        feedback.items = items;

    return success('done', feedback);
}

function init(fastify) {

    dbg('init: feedback-service');

    fastify.post('/customer/feedback/apply', funcScopedAsync(feedbackApplyAsync, SCOPE_CUSTOMER));
    fastify.post('/customer/feedback/list', funcAsync(feedbackListAsync));
}

module.exports = {
    init
};