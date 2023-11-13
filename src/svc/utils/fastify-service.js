const {
    dbg,
    dbgErr
} = require('./debug-service');

let fastify = null;

let listening = false;

function init() {

    dbg('init: fastify-service');

    fastify = require('fastify')({
        logger: false,
        bodyLimit: process.env.MAX_POST_LIMIT || 30 * 1024 * 1024
    });


    fastify.register(require('fastify-file-upload'));
}

module.exports = {

    init,

    instance: () => fastify,

    listenAsync: async () => {
        if (!listening) {
            fastify.listen({
                port: process.env.PORT,
                host: process.env.HOST || '0.0.0.0'
            }, (err) => {
                if (err) {
                    dbgErr(err);
                    fastify.log.error(err);
                    process.exit(1);
                } else {
                    listening = true;
                    dbg('listening on', process.env.PORT);
                }
            });
        } else {
            dbg('listening on', process.env.PORT);
        }
    }
};