const mongoService = require("../db/mongo-service");
const { COLLECTION_STORES_ORDERS, COLLECTION_USERS_STREAKS } = require('../../proto/collections');

const { dbg } = require('../utils/debug-service');

const { SCOPE_CUSTOMER, SCOPE_ADMIN } = require("../../proto/scopes");
const { funcScopedAsync, success } = require("../utils/control-service");

// days:percent,days:percent 
const streakPolicy = process.env.STREAK_POLICY || '0:15,1:15,2:15,3:20';

async function streakAlarmAsync(username) {

    dbg('streak hit');
    let now = new Date();

    // 15% on 0 day
    // 15% on 1 day
    // 15% on 2 day
    // 20% on 3 day + vendor discount
    let streaks = streakPolicy.split(',');

    for (const streak of streaks) {

        let params = streak.split(':');
        let streakDays = Number(params[0]);
        let streakDiscount = Number(params[1]);

        let streakDate = now;
        let andExpr = [];
        let streakDates = [];

        if (streakDays == 0) {
            streakDates.push(Number(streakDate.toTimeZone().yyyymmdd));
            andExpr.push({ $in: [Number(streakDate.toTimeZone().yyyymmdd), "$dates"] });
            streakDate = streakDate.previousDate();
        }

        for (let i = 0; i < streakDays; i++) {
            streakDates.push(Number(streakDate.toTimeZone().yyyymmdd));
            andExpr.push({ $in: [Number(streakDate.toTimeZone().yyyymmdd), "$dates"] });
            streakDate = streakDate.previousDate();
        }

        let match = {
            scanDay: { $in: streakDates }
        };

        if (username)
            match.requestedBy = username;

        let groupMatch = [
            {
                $match: match
            },
            {
                $group: {
                    _id: {
                        requestedBy: "$requestedBy",
                        scanDay: "$scanDay"
                    },
                    count: { $sum: 1 }
                }
            },
            {
                $group: {
                    _id: "$_id.requestedBy",
                    dates: { $push: "$_id.scanDay" },
                    count: { $first: "$count" }
                }
            },
            {
                $match: {
                    $expr: {
                        $and: andExpr
                    }
                }
            }
        ];

        let found = await mongoService.aggregateAsync(COLLECTION_STORES_ORDERS, groupMatch);
        let streakItem = {
            day: now.toTimeZone().yyyymmdd,
            streakDays,
            streakDiscount,
            users: found.map(user => user._id)
        };

        if (streakItem.users.length > 0) {
            dbg('found streak', streakItem);

            if (username) {
                dbg('checking single user streak', { username });
                let currentStreak = await mongoService.findOneAsync(COLLECTION_USERS_STREAKS, {
                    day: now.toTimeZone().yyyymmdd,
                    streakDays
                });
                if (!currentStreak) {
                    dbg('no current streak');
                    await mongoService.insertOrUpdateAsync(COLLECTION_USERS_STREAKS, {
                        day: now.toTimeZone().yyyymmdd,
                        streakDays
                    }, {
                        $set: streakItem
                    }, {
                        upsert: true
                    });
                } else if (!currentStreak.users.indexOf(username)) {
                    dbg('updating current streak', { day: now.toTimeZone().yyyymmdd, username });
                    currentStreak.users.push(username);
                    await mongoService.insertOrUpdateAsync(COLLECTION_USERS_STREAKS, {
                        day: now.toTimeZone().yyyymmdd,
                        streakDays
                    }, {
                        $set: currentStreak
                    }, {
                        upsert: true
                    });
                } else {
                    dbg('user already in streak');
                }
            } else {
                await mongoService.insertOrUpdateAsync(COLLECTION_USERS_STREAKS, {
                    day: now.toTimeZone().yyyymmdd,
                    streakDays
                }, {
                    $set: streakItem
                }, {
                    upsert: true
                });
            }

        } else {
            dbg('skip empty streak', streakItem);
        }
    }

    setTimeout(streakAlarmAsync, process.env.STREAK_INTERVAL || 60 * 1000);
}

async function customerStreakAsync(request) {

    await streakAlarmAsync(request.user.username);

    let now = new Date();
    let userStreaks = await mongoService.findArrayAsync(COLLECTION_USERS_STREAKS, {
        day: now.toTimeZone().yyyymmdd,
        users: request.user.username
    });

    let maxStreak = 0;
    let userStreak = null;
    for (const streak of userStreaks) {
        if (streak.streakDays > maxStreak) {
            maxStreak = streak.streakDays;
            userStreak = streak;
        }
    }

    let end = new Date().toTimeZone().value.split(' ')[0] + ' 23:59:59';

    return success('done', userStreak ? {
        day: now.toTimeZone().yyyymmdd,
        userStreak: maxStreak,
        userDiscount: userStreak.streakDiscount,
        end
    } : {
        day: now.toTimeZone().yyyymmdd,
        userStreak: 0,
        userDiscount: process.env.DEFAULT_DISCOUNT || 15,
        end
    });
}

async function adminStreaksAsync(request) {

    let yyyymmdd = new Date().yyyymmdd();
    if (request.body.yyyymmdd)
        yyyymmdd = String(request.body.yyyymmdd);

    let streakData = await mongoService.findArrayAsync(COLLECTION_USERS_STREAKS, {
        day: yyyymmdd,
        users: request.user.username
    });

    return success('done', streakData);
}

function init(fastify) {

    dbg('init: streak-service');
    dbg('streak alarm', { streakPolicy });

    streakAlarmAsync();
    fastify.post('/customer/streak', funcScopedAsync(customerStreakAsync, SCOPE_CUSTOMER));
    fastify.post('/admin/streaks', funcScopedAsync(adminStreaksAsync, SCOPE_ADMIN));
}

module.exports = {
    init,
    customerStreakAsync,
    streakAlarmAsync
};