const {
    v4: uuidv4
} = require('uuid');
const { COLLECTION_METRICS } = require('../../proto/collections');

function dbg(...args) {
    if (process.env.DBG == 1) {
        let vargs = ['⏰', new Date().toLocaleString(), '→ '];
        vargs.push.apply(vargs, args);
        console.log.apply(null, vargs);
    }
}

const off = {};

const masked = (process.env.LOG_MASK || 'password,access_token')
    .split(',')
    .map(k => k.toLowerCase());

const skipMetrics = (process.env.SKIP_METRICS || '/service-worker.js,/admin/metrics,/favicon.ico')
    .split(',')
    .map(k => k.toLowerCase());

function dbgIf(...args) {

    let tag = `DBG_${args[0]}`;
    let enabled = process.env[tag] == 1;

    if (!enabled && !off[tag]) {
        dbg('TAG_DEBUG_OFF:', tag);
        off[tag] = 1;
    }

    if (enabled) {
        args.splice(0, 1);
        let vargs = ['⏰', new Date().toLocaleString(), '→ '];
        vargs.push.apply(vargs, args);
        console.log.apply(null, vargs);
    }
}

function dbgErr(...args) {
    let vargs = ['⏰', new Date().toLocaleString(), '→ '];
    vargs.push.apply(vargs, args);
    console.error.apply(null, vargs);
}

function rectify(response) {
    for (const key in response) {
        if (masked.indexOf(String(key).toLowerCase()) >= 0) {
            response[key] = '************';
        } else if (typeof response[key] === 'string' && response[key].length > 50) {
            response[key] = response[key].substring(0, 46) + '...';
        } else if (typeof response[key] === 'object') {
            rectify(response[key]);
        }
    }
    return response;
}

function init(fastify, mongoService) {

    dbg('init: debug-service');

    if (process.env.ENABLE_METRICS) {
        fastify.addHook('preHandler', (request, reply, done) => {
            done();

            let skip = false;
            skipMetrics.forEach(m => {
                if (request.url.toLowerCase().indexOf(m) >= 0)
                    skip = true;
            });

            if (skip)
                return;

            let now = new Date();
            let date = now.yyyymmdd();
            let hour = now.getHours();
            mongoService.insertOrUpdateAsync(COLLECTION_METRICS, {
                endpoint: request.url,
                date,
                hour
            }, {
                $inc: {
                    count: 1
                }
            }, {
                upsert: true
            });
            mongoService.insertOrUpdateAsync(COLLECTION_METRICS, {
                endpoint: 'generic',
                date,
                hour
            }, {
                $inc: {
                    count: 1
                }
            }, {
                upsert: true
            });
        });
    }

    if (process.env.LOG_REQ_RES) {
        fastify.addHook("preValidation", (req, reply, done) => {
            if (req.raw && req.raw.files) {
                reply.reqBody = { files: [] };
                for (let key in req.raw.files) {
                    try {
                        reply.reqBody.files.push({
                            'file': key,
                            'mimetype': req.raw.files[key].mimetype,
                            'size': req.raw.files[key].size,
                            'md5': req.raw.files[key].md5
                        });
                    } catch (e) {
                        dbgErr('log-err', e);
                    }
                }
            } else {
                reply.reqBody = req.body;
            }
            reply.startTime = Date.now();
            done();
        });

        fastify.addHook("preSerialization", (req, reply, payload, done) => {
            payload.ref = uuidv4();
            reply.resBody = payload;
            done(null, payload);
        });

        fastify.addHook("onResponse", (req, reply) => {
            try {
                let out = {
                    request: {},
                    response: {},
                };
                if (process.env.LOG_REQ_RES_HEADERS) {
                    out.request.headers = req.raw.headers;
                    let headers = reply.raw._header.split('\r\n');
                    out.response.headers = {};
                    for (const header of headers) {
                        let first = header.indexOf(':');
                        if (first > 0 && first < header.length - 1) {
                            let key = header.substring(0, first);
                            let val = header.substring(first + 1).trim();
                            out.response.headers[key] = val;
                        }
                    }
                }
                out.request.body = reply.reqBody;
                out.response.body = reply.resBody;
                dbg(
                    `API CALL [${reply.statusCode}] (${Date.now() - reply.startTime}ms)\n`,
                    req.raw.url,
                    JSON.stringify(rectify(out), null, 4)
                );
            } catch (e) {
                dbgErr(String(e), e);
            }
        });
    }
}

module.exports = {
    init,
    dbg,
    dbgErr,
    dbgIf,
    logRef: (...args) => {
        let ref = uuidv4();
        dbgErr(ref, ...args);
        return ref;
    }
};