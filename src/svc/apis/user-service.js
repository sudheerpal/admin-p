const mongoService = require("../db/mongo-service");
const mailService = require('../mails/mail-service');

const passValidator = require('password-validator');

const passSchema = new passValidator();
const mailValidator = require("email-validator");

const { COLLECTION_USERS, COLLECTION_CATEGORIES, COLLECTION_STORES, COLLECTION_BRANCHES, COLLECTION_PRODUCTS, COLLECTION_BRANCHES_CATEGORIES, COLLECTION_CLASSES, COLLECTION_BRANCHES_RANKS } = require('../../proto/collections');

const { dbg } = require('../utils/debug-service');
const { SCOPE_DEFAULT, SCOPE_CUSTOMER, SCOPE_VENDOR } = require('../../proto/scopes');

const {
    success,
    error,
    redis,
    authenticateUserAsync,
    generateTokenAsync,
    funcSessionAsync,
    randomCode,
    funcScopedAsync,
    funcAsync,
    getPagingParams,
} = require('../utils/control-service');
const { CUSTOMER, VENDOR, ADMIN } = require("../../proto/types");
const dataService = require("./data-service");
const { findAsync, saveAsync } = require("./data-service");
const { fsGetImageAsync, db } = require("../db/mongo-service");

async function mailVerificationCodeAsync(email, code) {
    const within = Number(process.env.EMAIL_VERIFICATION_TIME_LIMIT_MINUTES);
    const subject = process.env.EMAIL_VERIFICATION_SUBJECT;
    const message = process.env.EMAIL_VERIFICATION_MESSAGE
        .replace('__code__', code)
        .replace('__within_minutes__', within);
    await mailService
        .sendAsync(email, subject, message);
}

async function registerUserAsync(request) {

    let username = String(request.body.username).toLowerCase().trim();
    let email = String(request.body.email).toLowerCase().trim();
    let password = String(request.body.password);

    let phone = String(request.body.phone || '');
    let firstname = String(request.body.firstname || '');
    let lastname = String(request.body.lastname || '');

    let type = String(request.body.type || CUSTOMER).toLowerCase().trim();
    if (type != CUSTOMER && type != VENDOR) {
        return error('invalid user type', [CUSTOMER, VENDOR]);
    }

    username = email;

    let user = await mongoService.findOneAsync(COLLECTION_USERS, {
        username
    });

    if (user && user.verified == true) {
        return error("already registered");
    }

    const within = Number(process.env.EMAIL_VERIFICATION_TIME_LIMIT_MINUTES);

    if (user && user.verification && user.verification.expiry + within * 60 * 1000 > Date.now()) {
        return error('email verification cooldown', {
            until: user.verification.expiry + within * 60 * 1000
        });
    }

    if (user && user.username == username && user.verified == true) {
        return error('user already registered', username);
    }

    let failed = passSchema.validate(password, {
        list: true
    });

    if (failed && failed.length > 0) {
        return error('invalid password', {
            password,
            failed
        });
    } else {
        password = password.hash();
    }

    if (!mailValidator.validate(email)) {
        return error('invalid email', {
            email
        });
    } else {
        let mailUser = await mongoService.findOneAsync(COLLECTION_USERS, {
            email
        });
        if (mailUser != null && mailUser.verified == true) {
            return error('email already registered');
        }
    }

    let scopes = SCOPE_DEFAULT;

    if (type == CUSTOMER)
        scopes += ',' + SCOPE_CUSTOMER;

    if (type == VENDOR)
        scopes += ',' + SCOPE_VENDOR;

    let registration = {
        username,
        email,
        password,
        firstname,
        lastname,
        phone,
        verified: false,
        locked: false,
        joined: Date.now(),
        type,
        scopes,
        verification: {
            code: randomCode(),
            expiry: Date.now() + within * 60 * 1000,
            tries: 0
        }
    };

    await mailVerificationCodeAsync(email, registration.verification.code);

    await mongoService.insertOrUpdateAsync(COLLECTION_USERS, {
        username
    }, {
        $set: registration
    }, {
        upsert: true
    });

    return success("user created, awaiting email validation", {
        username,
        email
    });
}

async function verifyUserAsync(request) {

    let username = String(request.body.username).toLowerCase().trim();
    let verificationCode = String(request.body.code).toLowerCase().trim();

    let user = await mongoService.findOneAsync(COLLECTION_USERS, {
        username
    });

    if (user == null)
        return error('invalid match', {
            username,
            verificationCode
        });

    if (user.verified === true) {
        return error('already verified', username);
    }

    if (Date.now() > user.verification.expiry) {
        await mongoService.deleteAsync(COLLECTION_USERS, {
            username
        });
        return error('verification expired, please signup again');
    }

    if (user.verification.code == verificationCode) {

        await mongoService.insertOrUpdateAsync(COLLECTION_USERS, {
            username: user.username
        }, {
            $set: {
                verified: true,
                blocked: false,
                enabled: user.type == CUSTOMER,
                "verification.tries": ++user.verification.tries,
                joined: Date.now()
            }
        });

        if (user.type == CUSTOMER) {
            let access_token = await generateTokenAsync({
                username: user.username,
                email: user.email,
                scopes: user.scopes ? user.scopes.split(',') : [SCOPE_DEFAULT]
            });
            return success('account verified', { username, access_token });
        }

        if (user.type == VENDOR) {
            return success('account email verified, profile awaiting confirmation', { username, confirmed: false });
        }

        return error('invalid operation');

    } else {

        await mongoService.insertOrUpdateAsync(COLLECTION_USERS, {
            username: user.username
        }, {
            $set: {
                "verification.tries": ++user.verification.tries
            }
        });

        if (user.verification.tries >= Number(process.env.EMAIL_VERIFICATION_RETRIES_LIMIT)) {
            await mongoService.deleteAsync(COLLECTION_USERS, {
                username
            });
            return error('verification retries exceeded, please signup again');
        }

        return error('invalid match', {
            username,
            verificationCode
        });
    }
}

async function loginUserAsync(request) {

    let password = String(request.body.password).hash();

    let user = await mongoService.findOneAsync(COLLECTION_USERS, {
        username: String(request.body.username).toLowerCase(),
        password
    });

    if (user == null) {
        return error('invalid credentials', { invalid: true });
    } else if (user.verified != true) {
        return error('unverified', { verified: false });
    } else {

        if (!user.type) {
            return error('invalid user type');
        }

        if (user.type == CUSTOMER || user.type == ADMIN) {
            if (user.blocked == true) {
                return error('blocked');
            } else {
                return success('authenticated', await generateTokenAsync({
                    username: user.username,
                    email: user.email,
                    scopes: user.scopes ? user.scopes.split(',') : [SCOPE_DEFAULT]
                }));
            }
        }
        else if (user.type == VENDOR) {
            if (user.enabled == true) {
                return success('authenticated', await generateTokenAsync({
                    username: user.username,
                    email: user.email,
                    type: user.type,
                    scopes: user.scopes ? user.scopes.split(',') : [SCOPE_DEFAULT]
                }));
            } else {
                return error('not enabled');
            }
        } else return error('invalid operation');
    }
}

async function logoutUserAsync(request) {
    redis().del(result.success.data.user.username);
    return success('logged out');
}

async function resetUserAsync(request) {

    let filter = {};

    if (request.body.email)
        filter.email = String(request.body.email).toLowerCase().trim();

    if (request.body.username)
        filter.username = String(request.body.username).toLowerCase().trim();

    let user = await mongoService.findOneAsync(COLLECTION_USERS, filter);

    if (user == null) {
        if (request.body.resetCode)
            return error('invalid reset code');
        return success('reset code sent');
    }

    let resetCode = request.body.resetCode;
    let password = request.body.password;

    const within = Number(process.env.EMAIL_VERIFICATION_TIME_LIMIT_MINUTES);

    if (resetCode && password) {

        if (user.resetExpiry < Date.now())
            return error('expired, please retry again');

        if (!user.resetCode)
            return error('invalid reset');

        if (user.resetCode == String(resetCode)) {
            let failed = passSchema.validate(password, {
                list: true
            });
            if (failed && failed.length > 0) {
                return error('invalid password', {
                    password,
                    failed
                });
            } else {
                password = hashText(password, process.env.HASH_KEY, process.env.HASH_SALT);
            }
            await mongoService.insertOrUpdateAsync(COLLECTION_USERS, {
                username: user.username
            }, {
                $set: {
                    password
                },
                $unset: {
                    resetCode: 1,
                    resetExpiry: 1
                }
            });
            redis().del(user.username);
            return success('reset successfully', await generateTokenAsync({
                username: user.username,
                email: user.email
            }));
        }
    } else if (!resetCode && !password) {
        if (user.resetCode && user.resetExpiry > Date.now()) {
            return error('too many requests', {
                until: user.resetExpiry
            });
        }
        let resetCode = randomCode();
        await mailVerificationCodeAsync(user.email, resetCode);
        await mongoService.insertOrUpdateAsync(COLLECTION_USERS, {
            username: user.username
        }, {
            $set: {
                resetCode,
                resetExpiry: Date.now() + within * 60 * 1000
            }
        });
        return success('reset code sent');
    } else {
        return error('invalid reset');
    }
}

async function userProfileAsync(request) {

    let user = await mongoService.findOneAsync(COLLECTION_USERS, {
        username: request.user.username
    });

    if (!user)
        return error('invalid user operation');

    let update = false;

    if (request.body.fullname) {
        update = true;
        user.fullname = request.body.fullname;
    }

    if (request.body.phone) {
        update = true;
        user.phone = request.body.phone;
    }

    if (request.body.photo) {
        update = true;
        user.photo = request.body.photo;
    }

    if (update === true) {
        saveAsync({ collection: COLLECTION_USERS, index: { username: user.username }, item: user });
    }

    let {
        username,
        email,
        verified,
        fullname,
        phone,
        photo
    } = user;

    return success('user profile', {
        username,
        email,
        verified,
        fullname,
        phone,
        photo
    });
}

async function categoriesListAsync(request) {
    let filter = {};
    if (request.body.like)
        filter.title = {
            $regex: new RegExp(request.body.like, "i")
        };
    let { page, pageSize } = getPagingParams(request);
    let result = await dataService.findAsync({ collection: COLLECTION_CATEGORIES, filter, page, pageSize, sort: { name: 1 } });

    let categories = result.success.data;

    for (const category of categories) {
        if (request.body.noImages) {
            delete category.image;
        }
    }

    return result;
}

async function vendorClassViewAsync(request) {
    if (!request.body.name || String(request.body.name).length <= 1) {
        return error('invalid class name');
    }
    let name = String(request.body.name).toLowerCase().trim();
    return await dataService.findOneAsync({ collection: COLLECTION_CLASSES, filter: { name } });
}

async function vendorStoreViewAsync(request) {
    if (!request.body.name || String(request.body.name).length <= 1) {
        return error('invalid store name');
    }
    let name = String(request.body.name).toLowerCase().trim();
    let result = await dataService.findOneAsync({ collection: COLLECTION_STORES, filter: { name } });
    if (result.success && result.success.data) {
        let image = await fsGetImageAsync(`store-image-${name.toLowerCase()}`);
        result.success.data.image = image;
    }
    return result;
}

async function vendorClassListAsync(request) {
    let filter = {};
    if (request.body.vendor)
        filter.vendor = String(request.body.vendor);
    if (request.body.enabled)
        filter.enabled = String(request.body.enabled) == "true";
    let { page, pageSize } = getPagingParams(request);
    return await dataService.findAsync({ collection: COLLECTION_CLASSES, filter, page, pageSize, sort: { name: 1 } });
}

async function vendorStoreListAsync(request) {

    let filter = {};

    if (request.body.vendor)
        filter.vendor = String(request.body.vendor);

    if (request.body.storeLike)
        filter.title = {
            $regex: new RegExp(request.body.storeLike, "i")
        };

    if (request.body.enabled)
        filter.enabled = String(request.body.enabled) == "true";


    let { page, pageSize } = getPagingParams(request);

    let result = await dataService.findAsync({
        collection: COLLECTION_STORES,
        filter,
        page,
        pageSize,
        sort: {
            name: 1
        }
    });

    let stores = result.success.data;


    for (const store of stores) {
        if (request.body.noImages) {
            delete store.image;
        } else {
            try {
                store.image = await fsGetImageAsync(`store-image-${store.name.toLowerCase()}`);
            } catch (e) {
                return error('error fetching images', e);
            }
        }
    }

    return result;
}

async function vendorBranchesViewAsync(request) {
    return await dataService.findOneAsync({
        collection: COLLECTION_BRANCHES,
        filter: {
            name: request.body.name
        }
    });
}

async function vendorBranchesListAsync(request) {

    let filter = {

    };

    if (!request.body.vendor && !request.body.store)
        return error('missing vendor/store');

    if (request.body.vendor)
        filter.vendor = String(request.body.vendor);

    if (request.body.store)
        filter.store = String(request.body.store);

    if (request.body.enabled)
        filter.enabled = String(request.body.enabled) == "true";
    let { page, pageSize } = getPagingParams(request);

    let result = await dataService.findAsync({
        collection: COLLECTION_BRANCHES,
        sort: {
            name: 1
        },
        filter,
        page,
        pageSize,
    });

    let branches = result.success.data;

    for (const branch of branches) {
        if (request.body.noImages) {
            delete branch.image;
        }
    }

    return result;
}

async function vendorBranchesNearbyAsync(request) {

    let withinKM = request.body.within || 4;
    let lat = Number(request.body.latitude);
    let lng = Number(request.body.longitude);

    if (isNaN(lng) || isNaN(lat))
        return error('invalid coordinates');

    let params = {
        collection: COLLECTION_BRANCHES,
        filter: {
            location: {
                $geoWithin: {
                    $centerSphere: [[lng, lat], withinKM / 6371]
                }
            },
            enabled: true
        }
    };

    if (request.body.storeLike) {
        params.filter.title = {
            $regex: new RegExp(request.body.storeLike, "i")
        };
    } else if (request.body.category) {
        let category = String(request.body.category);
        let stores = await mongoService.findArrayAsync(COLLECTION_STORES, {
            category
        }, {
            name: 1
        });
        params.filter.store = {
            $in: stores.map(store => store.name)
        };
    }

    let result = await findAsync(params);

    let branches = result.success.data;

    for (const branch of branches) {
        if (request.body.noImages) {
            delete branch.image;
        }
    }

    return result;
}

async function categoryApplyAsync(request) {

    if (!request.body.category && !request.body.store)
        return error('missing data, needed {category, store}');

    let storeName = String(request.body.store).toLowerCase().trim();
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

    let result = await saveAsync({
        collection: COLLECTION_BRANCHES_CATEGORIES,
        index: {
            store: storeName,
            user: request.user.username
        },
        item: {
            store: storeName,
            category: categoryName,
            user: request.user.username
        },
        sort: {
            name: 1
        }
    });

    let rank = Number(request.body.rank);
    if (Number.isInteger(rank) && rank > 0 & rank < 6) {
        let comment = String(request.body.comment || '');
        result = await saveAsync({
            collection: COLLECTION_BRANCHES_RANKS,
            index: {
                store: storeName,
                user: request.user.username
            },
            item: {
                rank,
                comment,
                rankedAt: new Date().now(),
                rankedAtUTC: new Date().toUTCString()
            },
            sort: {
                name: 1
            }
        });
    }

    result = await mongoService.aggregateAsync(COLLECTION_BRANCHES_CATEGORIES, [
        {
            $match: { store: storeName }
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

    saveAsync({
        collection: COLLECTION_STORES,
        index: {
            name: storeName
        },
        item: {
            category: result[0]._id
        },
        sort: {
            name: 1
        }
    });

    return result;
}

async function vendorBranchesProductsAsync(request) {

    let branch = request.body.branch;
    let store = request.body.store;
    let product = request.body.product;

    if (!branch && !store && !product) {
        return error('at least one of {store,branch,product} to be present');
    }

    let filter = {};

    if (store) filter.store = store.toLowerCase().trim();
    if (branch) filter.branch = branch.toLowerCase().trim();
    if (product) filter.product = product.toLowerCase().trim();


    if (request.body.enabled)
        filter.enabled = String(request.body.enabled) == "true";

    let result = await findAsync({
        collection: COLLECTION_PRODUCTS,
        filter,
        sort: {
            name: 1
        }
    });

    if (result && result.success && Array.isArray(result.success.data)) {
        for (const product of result.success.data) {
            product.discount = branch.discount;
            if (request.body.noImages) {
                delete product.image;
            }
        }
    }

    return result;
}

function init(fastify) {

    dbg('init: user-service');

    passSchema
        .is().min(8)
        .is().max(100)
        .has().uppercase()
        .has().lowercase()
        .has().digits(2)
        .has(/[\W\S]/)
        .has().not().spaces()
        .is().not().oneOf(['Passw0rd', 'Password123']);

    fastify.post('/user/register', funcAsync(registerUserAsync));
    fastify.post('/user/verify', funcAsync(verifyUserAsync));
    fastify.post('/user/login', funcAsync(loginUserAsync));
    fastify.post('/user/authenticate', funcAsync(authenticateUserAsync));
    fastify.post('/user/logout', funcSessionAsync(logoutUserAsync));
    fastify.post('/user/reset', funcAsync(resetUserAsync));

    fastify.post('/user/profile', funcSessionAsync(userProfileAsync));

    fastify.post('/categories/list', funcAsync(categoriesListAsync));

    fastify.post('/vendors/stores/view', funcAsync(vendorStoreViewAsync));
    fastify.post('/vendors/stores/list', funcAsync(vendorStoreListAsync));

    fastify.post('/vendors/classes/view', funcAsync(vendorClassViewAsync));
    fastify.post('/vendors/classes/list', funcAsync(vendorClassListAsync));

    fastify.post('/vendors/branches/nearby', funcAsync(vendorBranchesNearbyAsync));
    fastify.post('/vendors/branches/list', funcAsync(vendorBranchesListAsync));
    fastify.post('/vendors/branches/view', funcAsync(vendorBranchesViewAsync));
    fastify.post('/vendors/branches/products', funcAsync(vendorBranchesProductsAsync));

    fastify.post('/vendors/category/apply', funcScopedAsync(categoryApplyAsync, SCOPE_CUSTOMER));
}

module.exports = {
    init
};