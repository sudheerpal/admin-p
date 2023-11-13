const {
    dbg
} = require('../utils/debug-service');

const API_KEY = process.env.MAILGUN_API_KEY;
const DOMAIN = process.env.MAILGUN_DOMAIN;

const formData = require('form-data');
const Mailgun = require('mailgun.js');

const mailgun = new Mailgun(formData);
const client = mailgun.client({
    username: 'api',
    key: API_KEY
});

const SENDER = process.env.MAILGUN_SENDER;

function mailMessageAsync(to, subject, text) {
    return new Promise((res, rej) => {
        client.messages.create(DOMAIN, {
                from: `GME <${SENDER}>`,
                to,
                subject,
                text
            })
            .then(res)
            .catch(rej);
    });
}

function init() {
    dbg('init: mail-service');
}

module.exports = {
    init,
    sendAsync: mailMessageAsync
};