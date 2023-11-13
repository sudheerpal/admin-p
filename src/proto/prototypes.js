const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const bigDecimal = require('bigdecimal');

const {
    dbg,
    dbgErr
} = require('../svc/utils/debug-service');

String.prototype.isAlphaNumeric = function () {
    var regExp = /^[A-Za-z0-9]+$/;
    return (null != this.match(regExp));
};

String.prototype.hexEncode = function () {
    let hex, i, result = "";
    for (i = 0; i < this.length; i++) {
        hex = this.charCodeAt(i).toString(16);
        result += ("000" + hex).slice(-4);
    }
    return result;
};

String.prototype.hexDecode = function () {
    let j, hexes = this.match(/.{1,4}/g) || [],
        back = "";
    for (j = 0; j < hexes.length; j++) {
        back += String.fromCharCode(parseInt(hexes[j], 16));
    }
    return back;
};

Date.prototype.toTimeZone = function (num = false) {
    const timeZone = process.env.APE_TIMEZONE || 'Asia/Dubai';
    const string = this.toLocaleString('en-US', {
        timeZone: timeZone,
        hour12: false, // set to true if you want 12-hour format
    });
    const parts = string.split(', ');
    const lpad = (x) => x.length < 2 ? `0${x}` : x;
    const dateParts = parts[0].split('/');
    const timeParts = parts[1].split(':');
    const year = dateParts[2];
    const month = lpad(dateParts[0]);
    const day = lpad(dateParts[1]);
    const hour = lpad(timeParts[0]);
    const minute = lpad(timeParts[1]);
    const second = lpad(timeParts[2]);
    const yyyymmdd = Number(`${year}${month}${day}`);
    const hhmmss = Number(`${hour}${minute}${second}`);
    const yyyymmddHHmmss = Number(`${yyyymmdd}${hhmmss}`);
    const utc = new Date(this);
    if (num == true)
        return yyyymmddHHmmss;
    return {
        year: Number(year),
        month: Number(month),
        day: Number(day),
        hour: Number(hour),
        minute: Number(minute),
        second: Number(second),
        yyyymmdd,
        hhmmss,
        yyyymmddHHmmss,
        timeZone,
        utc,
        value: string
    };
};

String.prototype.hash = function (salt, key) {
    let hmac = crypto.createHmac('sha512', key || process.env.HASH_KEY);
    let clear = this;
    if (salt || process.env.HASH_SALT)
        clear += salt || process.env.HASH_SALT;
    hmac.update(clear);
    return hmac.digest('hex').toString();
};

String.prototype.bigDecimal = function () {
    return new bigDecimal.BigDecimal(this + '');
};

Number.prototype.bigDecimal = function () {
    return new bigDecimal.BigDecimal(this + '');
};

Date.prototype.yyyymmdd = function () {
    let mm = this.getMonth() + 1; // getMonth() is zero-based
    let dd = this.getDate();
    return [
        this.getFullYear(),
        (mm > 9 ? '' : '0') + mm,
        (dd > 9 ? '' : '0') + dd
    ].join('');
};

Date.prototype.previousDate = function () {
    let next = new Date(this.getTime() - 24 * 3600 * 1000);
    return new Date(next.getFullYear(), next.getMonth(), next.getDate());
};

Date.prototype.nextDate = function () {
    let next = new Date(this.getTime() + 24 * 3600 * 1000);
    return new Date(next.getFullYear(), next.getMonth(), next.getDate());
};

String.prototype.jwtDecode = function (key) {
    try {
        return jwt.verify(this + '', key || process.env.JWT_SECRET);
    } catch (e) {
        dbgErr(e);
        return null;
    }
};

global.jwtSign = function (data, key) {
    data.access_token = jwt.sign(data, key || process.env.JWT_SECRET);
    return data;
};

function init() {
    dbg('init: prototypes');
}

module.exports = {
    init
};