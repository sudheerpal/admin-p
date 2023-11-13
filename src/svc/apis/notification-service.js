const request = require('request');
const { COLLECTION_PUSH } = require('../../proto/collections');
const { SCOPE_CUSTOMER, SCOPE_ADMIN } = require('../../proto/scopes');
const mongoService = require('../db/mongo-service');
const { funcSessionAsync, success, error } = require('../utils/control-service');
const { dbgErr, dbg } = require('../utils/debug-service');
const { saveAsync, deleteAsync } = require('./data-service');

async function validateAndSaveTokenAsync(_request) {
    let token = _request.body.token;
    let username = _request.user.username;
    return new Promise((res, rej) => {
        let fcmURL = 'https://fcm.googleapis.com/fcm/send';
        let headers = { 'Authorization': `key=${process.env.FCM_KEY}`, 'Content-Type': 'application/json' };
        let fields = { 'registration_ids': [token] };
        let options = { url: fcmURL, method: 'POST', headers: headers, json: true, body: fields };
        async function callback(_error, response, body) {
            dbg('push subscribe', _error || response.statusCode, JSON.stringify(body));
            if (!_error && response.statusCode === 200) {
                if (body.success === 1) {
                    await saveAsync({
                        collection: COLLECTION_PUSH,
                        index: {
                            username
                        },
                        item: {
                            token
                        }
                    });
                    res(success('ok', body));
                } else {
                    res(error('failed', body));
                }
            } else {
                dbgErr('error GCM', error, response.statusCode);
                res(error('failed', body));
            }
        }
        request(options, callback);
    });
}

// alert { notification, data, usernames[] }
async function broadcastAlertsAsync(_request) {

    const alert = _request.body;

    if (!alert && !alert.usernames && !Array.isArray(alert.usernames))
        return error('invalid alert/usernames');

    if (!process.env.FCM_KEY) {
        dbg('push notification mock:', alert);
        return;
    }

    let fcmURL = 'https://fcm.googleapis.com/fcm/send';

    let subscribers = [];

    for (let username of alert.usernames) {
        let nextSubs = await mongoService.findArrayAsync(COLLECTION_PUSH, { username });
        subscribers.push(...nextSubs);
    }

    if (subscribers.length == 0 && alert.usernames.length == 0) {
        subscribers = await mongoService.findArrayAsync(COLLECTION_PUSH, {});
    }

    return new Promise((res, rej) => {
        dbg('broadcastAlert', alert, subscribers);
        if (subscribers.length > 0) {
            let tokens = subscribers.map(sub => sub.token);
            let headers = { 'Authorization': `key=${process.env.FCM_KEY}`, 'Content-Type': 'application/json' };
            let fields = { 'registration_ids': tokens };
            if (alert.notification) {
                fields.notification = alert.notification;
            }
            if (alert.data) {
                fields.data = alert.data;
            }
            let options = { url: fcmURL, method: 'POST', headers: headers, json: true, body: fields };
            request(options, (_error, response, body) => {
                if (!_error && response.statusCode === 200) {
                    if (body && body.results) {
                        let results = body.results;
                        for (let r = 0; r < results.length; r++) {
                            let token = tokens[r];
                            if (results[r].error === 'NotRegistered') {
                                dbg('pushToken clean...');
                                deleteAsync({ collection: COLLECTION_PUSH, filter: { token } });
                            }
                        }
                    }
                    dbg('broadcast ok');
                    res(success("ok", body));
                } else {
                    dbgErr('error GCM', _error, response.statusCode);
                    res(error("failed", body));
                }
            });
        } else {
            res(error("failed no subs"));
        }
    });
}


function init(fastify) {
    dbg('init: user-service');
    fastify.post('/push/subscribe', funcSessionAsync(validateAndSaveTokenAsync, SCOPE_CUSTOMER));
    fastify.post('/push/broadcast', funcSessionAsync(broadcastAlertsAsync, SCOPE_ADMIN));
}

module.exports = {
    init,
    broadcastAlertsAsync: broadcastAlertsAsync
};