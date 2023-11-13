const scopes = require('../../proto/scopes');
const { dbgIf } = require('../utils/debug-service');
const debugService = require('../utils/debug-service');

const dbg = debugService.dbg;

let _fastify = null;

let redis = () => _fastify.redis;

function error(message, data, exception) {
    if (exception)
        console.trace(exception);
    return {
        "error": {
            "message": message || null,
            "data": data || null,
            "tag": debugService.logRef(message, exception)
        }
    };
}

function success(message, data) {
    return {
        "success": {
            "message": message || null,
            "data": data || null
        }
    };
}

async function validTokenAsync(token) {
    let decoded = token.jwtDecode();
    if (decoded) {
        let cached = await redis().get(decoded.user.username);
        if (token == cached) {
            if (token.expiresAt < Date.now()) {
                return error('expired token', decoded);
            }
            return success('valid token', decoded);
        }
        return error('invalid token', {
            expired: true
        });
    } else {
        return error('invalid token', {
            token
        });
    }
}

async function authenticateUserAsync(request) {
    try {
        if (request.headers.authorization || request.query.access_token) {
            let access_token = request.headers.authorization ? request.headers.authorization.split(' ')[1] : request.query.access_token;
            return await validTokenAsync(access_token);
        }
        return error('invalid token', { headers: request.headers });
    } catch (e) {
        return error('invalid token', null, e);
    }
}

function randomCode() {
    return String(Math.random() * Date.now()).substring(4, 9);
}

async function generateTokenAsync(user) {
    let tokenResponse = jwtSign({
        success: true,
        expiresAt: Date.now() + Number(process.env.JWT_SESSION_TIMEOUT_DAYS * 24 * 3600 * 1000),
        user: user,
        ticket: randomCode().hash(randomCode()).substring(0, 32),
    });
    await redis().set(user.username, tokenResponse.access_token);
    return tokenResponse;
}


let funcAsync = (fun) =>
    async (request, reply) => {
        try {
            reply.type('application/json');
            return await fun(request, reply);
        } catch (e) {
            return error('internal error', null, e);
        }
    };

let funcHTMLAsync = (fun) =>
    async (request, reply) => {
        try {
            reply.type('text/html');
            return await fun(request, reply);
        } catch (e) {
            return error('internal error', null, e);
        }
    };

let funcRawAsync = (fun) =>
    async (request, reply) => {
        try {
            return await fun(request, reply);
        } catch (e) {
            return error('internal error', null, e);
        }
    };

let funcSessionAsync = (fun) =>
    async (request, reply) => {
        try {
            reply.type('application/json');
            let authenticated = await authenticateUserAsync(request);
            if (authenticated.success) {
                request.user = authenticated.success.data.user;
                return await fun(request, reply);
            } else {
                return authenticated;
            }
        } catch (e) {
            return error('internal error', null, e);
        }
    };

let hasScope = (requiredScopes, availableScopes) => {
    if (!requiredScopes || requiredScopes.length == 0)
        return true;
    for (const availableScope of availableScopes) {
        for (const requiredScope of requiredScopes) {
            dbg('scope check:', requiredScope, availableScope, availableScope === requiredScope);
            if (requiredScope === availableScope)
                return true;
        }
    }
    return false;
};

let validateRequestScopeAsync = async (request, ...scopes) => {
    try {
        let authenticated = await authenticateUserAsync(request);
        if (authenticated.success) {
            if (hasScope(scopes, authenticated.success.data.user.scopes)) {
                request.user = authenticated.success.data.user;
                return success('valid scope');
            } else {
                return error('invalid scope', {
                    required: scopes,
                    found: authenticated.success.data.user.scopes
                });
            }
        } else {
            return authenticated;
        }
    } catch (e) {
        return error('internal error', null, e);
    }
};

let funcStream = (fun) => (request, reply) => { fun(request, reply); };

let funcScoped = (fun, ...scopes) => (request, reply) => {
    try {
        reply.type('application/json');
        if (!scopes || scopes.length == 0) {
            fun(request, reply);
        } else {
            authenticateUserAsync(request).then(authenticated => {
                if (authenticated.success) {
                    if (hasScope(scopes, authenticated.success.data.user.scopes)) {
                        request.user = authenticated.success.data.user;
                        fun(request, reply);
                    } else {
                        reply.send(error('invalid scope', {
                            required: scopes,
                            found: authenticated.success.data.user.scopes
                        }));
                    }
                } else {
                    reply.send(authenticated);
                }
            });
        }
    } catch (e) {
        reply.send();
    }
};

let funcScopedAsync = (fun, ...scopes) =>
    async (request, reply) => {
        try {
            reply.type('application/json');
            let authenticated = await authenticateUserAsync(request);
            if (authenticated.success) {
                if (hasScope(scopes, authenticated.success.data.user.scopes)) {
                    request.user = authenticated.success.data.user;
                    return await fun(request, reply);
                } else {
                    return error('invalid scope', {
                        required: scopes,
                        found: authenticated.success.data.user.scopes
                    });
                }
            } else {
                return authenticated;
            }
        } catch (e) {
            return error('internal error', null, e);
        }
    };

let getPagingParams = (request) => {

    let page = 1;
    if (Number.isInteger(request.body.page) && request.body.page > 0) {
        page = Number(request.body.page);
    }

    let pageSize = Number(process.env.DEFAULT_PAGE_SIZE || 10);
    if (Number.isInteger(request.body.pageSize) && request.body.pageSize > 0) {
        pageSize = Number(request.body.pageSize);
        let maxPageSize = Number(process.env.MAX_PAGE_SIZE) || 100;
        pageSize = pageSize > maxPageSize ? maxPageSize : pageSize;
    }

    return { page, pageSize };
};

function init(fastify) {

    dbg('init: control-service');

    const redis = require('redis');

    dbg('connecting to redis...');
    const client = redis.createClient({ url: process.env.REDIS_URL, no_ready_check: true });

    client.connect();

    fastify.register(require('@fastify/redis'), { client });
    if (process.env.CHECK_CORS) {
        fastify.register(require('@fastify/cors'), {
            origin: (origin, cb) => {
                cb(null, true);
            }
        });
    }

    _fastify = fastify;
}

module.exports = {

    init,

    redis,

    funcAsync,
    funcRawAsync,
    funcHTMLAsync,
    funcSessionAsync,

    hasScope,

    funcScoped,
    funcStream,
    funcScopedAsync,

    success,
    error,

    randomCode,
    getPagingParams,

    validTokenAsync,
    generateTokenAsync,
    authenticateUserAsync,
    validateRequestScopeAsync
};