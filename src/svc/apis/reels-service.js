const mongoService = require("../db/mongo-service");
const mongo = require('mongodb');

const {
    success,
    error,
    funcScopedAsync,
    funcHTMLAsync,
    funcScoped,
    getPagingParams,
    funcAsync,
    funcStream,
} = require('../utils/control-service');


const { dbg } = require('../utils/debug-service');
const { SCOPE_ADMIN, SCOPE_VENDOR, SCOPE_USER } = require('../../proto/scopes');
const { saveAsync, findAsync } = require("./data-service");
const { COLLECTION_VENDOR_REELS, COLLECTION_REELS_LIKES, COLLECTION_BRANCHES } = require('../../proto/collections');
const { randomUUID } = require("crypto");

async function deleteReelAsync(request) {
    if (!request.body.uuid)
        return error('invalid uuid', uuid);

    let reel = await mongoService.findOneAsync(COLLECTION_VENDOR_REELS.concat('.files'), {
        'metadata.uuid': String(request.body.uuid),
        'metadata.uploadedBy': request.user.username
    }, {
        projection: {
            "_id": 1
        }
    });

    if (!reel)
        return error('invalid reel', { uuid: request.body.uuid });

    await mongoService.deleteAsync(COLLECTION_VENDOR_REELS.concat('.chunks'), {
        files_id: mongo.ObjectId.createFromHexString(String(reel._id))
    });
    let result = await mongoService.deleteAsync(COLLECTION_VENDOR_REELS.concat('.files'), {
        _id: mongo.ObjectId.createFromHexString(String(reel._id))
    });
    return success('delete done', result);
}

async function uploadReelAsync(request) {

    const files = request.raw.files;
    let file = {};
    let count = 0;
    for (let key in files) {
        count++;
        file = files[key];
    }
    if (count != 1)
        return error('invalid files');

    const MAX_SIZE = (process.env.MAX_REEL_SIZE_MB || 2) * 1024 * 1024;
    if (file.size > MAX_SIZE) {
        return error('invalid file size', { MAX_SIZE, size: file.size });
    }


    try {
        dbg('uploading...');
        let uuid = randomUUID();
        let metadata = {
            uuid,
            mimetype: file.mimetype,
            md5: file.md5,
            approved: false,
            uploadedBy: request.user.username
        };
        if (request.query.branch) {
            let branchName = String(request.query.branch).toLowerCase().trim();
            let branch = await mongoService.findOneAsync(COLLECTION_BRANCHES, {
                name: branchName,
                vendor: request.user.username
            });
            if (!branch) {
                return error('invalid vendor-branch', { vendor: request.user.username, branch: branchName });
            }

            metadata.branch = branch;
            delete metadata.branch.image;
            dbg('reels assigned to branch', branch.name);
        }
        await mongoService.fsPutReelAsync(file, metadata);
        dbg('uploaded...');
        return success('file uploaded, awaiting confirmation', metadata);
    } catch (e) {
        return error('could not upload reel', file.name, e);
    }
}

async function approveReelAsync(request) {

    if (!request.body.uuid) {
        return error('no uuid');
    }

    let reel = await mongoService.findOneAsync(COLLECTION_VENDOR_REELS.concat('.files'), {
        'metadata.uuid': String(request.body.uuid)
    });

    if (!reel)
        return error('reel not found', request.body.uuid);

    reel.metadata.approved = String(request.body.approved) == "true";

    reel.checkedBy = request.user.username;
    let now = new Date();
    reel.checkedAt = now.getTime();
    reel.checkedAtUTC = now.toUTCString();

    return await saveAsync({
        collection: COLLECTION_VENDOR_REELS.concat('.files'),
        index: {
            'metadata.uuid': reel.metadata.uuid
        },
        item: reel
    });
}

async function findReelsAsync(request) {
    let filter = {};

    if (request.body.uuid)
        filter["metadata.uuid"] = String(request.body.uuid);

    if (request.body.approved !== undefined)
        filter["metadata.approved"] = String(request.body.approved) == "true";

    if (request.body.vendor)
        filter["metadata.uploadedBy"] = String(request.body.vendor);

    let { page, pageSize } = getPagingParams(request);

    let result = await findAsync({
        collection: COLLECTION_VENDOR_REELS.concat('.files'),
        filter,
        page,
        pageSize,
        sort: {
            uploadDate: -1
        }
    });

    for (const reel of result.success.data) {
        if (reel.metadata.branch) {
            if (!request.body.noImages) {
                let branch = await mongoService.findOneAsync(COLLECTION_BRANCHES, {
                    name: reel.metadata.branch.name,
                    vendor: reel.metadata.branch.vendor,
                    store: reel.metadata.branch.store
                });
                if (!branch) {
                    return error('invalid reel-vendor-branch', { vendor: request.user.username, branch: branchName });
                }
                reel.metadata.branch.image = branch.image;
            } else {
                delete (reel.metadata.branch).image;
            }
        }
    }

    return result;
}

function watchVendorReels(req, res) {
    mongoService.findOneAsync(COLLECTION_VENDOR_REELS.concat('.files'), {
        'metadata.uuid': String(req.query.uuid),
        'uploadedBy': String(req.body.username)
    }).then(reel => {
        if (!reel) res.send(error('invalid reel', req.body));
        else watchReels(req, res);
    }).catch(e => res.send(error('watch reel error', req.body, e)));
}

function watchPublicReels(req, res) {
    mongoService.findOneAsync(COLLECTION_VENDOR_REELS.concat('.files'), {
        'metadata.uuid': String(req.query.uuid),
        'metadata.approved': true
    }).then(reel => {
        if (!reel) res.send(error('invalid reel', req.body));
        else watchReels(req, res);
    }).catch(e => res.send(error('watch reel error', req.body, e)));
}

async function findVendorReelsAsync(request) {

    let filter = {};

    filter["metadata.uploadedBy"] = request.user.username;

    if (request.body.approved !== undefined)
        filter["metadata.approved"] = String(request.body.approved) == "true";

    let sort = request.body.sort || {
        checkedAt: -1
    };


    let { page, pageSize } = getPagingParams(request);

    let result = await findAsync({
        collection: COLLECTION_VENDOR_REELS.concat(".files"),
        filter,
        page,
        pageSize,
        sort
    });

    for (const reel of result.success.data) {
        if (reel.metadata.branch) {
            if (!request.body.noImages) {
                let branch = await mongoService.findOneAsync(COLLECTION_BRANCHES, {
                    name: reel.metadata.branch.name,
                    vendor: reel.metadata.branch.vendor,
                    store: reel.metadata.branch.store
                });
                if (!branch) {
                    return error('invalid reel-vendor-branch', { vendor: request.user.username, branch: branchName });
                }
                reel.metadata.branch.image = branch.image;
            } else {
                delete (reel.metadata.branch).image;
            }
        }
    }

    return result;
}

async function findPublicReelsAsync(request) {

    let { page, pageSize } = getPagingParams(request);

    let result = await findAsync({
        collection: COLLECTION_VENDOR_REELS.concat('.files'),
        filter: { 'metadata.approved': true },
        page,
        pageSize,
        sort: {
            checkedAt: -1
        }
    });

    for (const reel of result.success.data) {

        let likesFilter = {
            uuid: reel.metadata.uuid
        };

        let likesResult = await likesReelsAsync({
            body: likesFilter
        });

        reel.likes = {
            totalCount: likesResult.totalCount
        };

        if (request.user) {
            likesFilter.username = request.user.username;
            likesResult = await likesReelsAsync({
                body: likesFilter
            });
            reel.userLike = request.user ? likesResult.foundCount > 0 : false;
        }

        if (reel.metadata.branch) {
            if (!request.body.noImages) {
                let branch = await mongoService.findOneAsync(COLLECTION_BRANCHES, {
                    name: reel.metadata.branch.name,
                    vendor: reel.metadata.branch.vendor,
                    store: reel.metadata.branch.store
                });
                if (!branch) {
                    return error('invalid reel-vendor-branch', { vendor: request.user.username, branch: branchName });
                }
                reel.metadata.branch.image = branch.image;
            } else {
                delete (reel.metadata.branch).image;
            }
        }
    }

    return result;
}

function watchReels(req, res) {

    const mongodb = require('mongodb');

    const range = req.headers.range;
    if (!range) {
        res.code(400).send(error("Requires Range header"));
        return;
    }

    const db = mongoService.db();
    dbg('query', req.query);
    db.collection(COLLECTION_VENDOR_REELS.concat('.files')).findOne({ 'metadata.uuid': req.query.uuid }).then((video) => {
        if (!video) {
            res.code(404).send("No video uploaded!");
            return;
        }
        const videoSize = video.length;
        const start = Number(range.replace(/\D/g, ""));
        const end = videoSize - 1;
        const contentLength = end - start + 1;
        const headers = {
            "Content-Range": `bytes ${start}-${end}/${videoSize}`,
            "Accept-Ranges": "bytes",
            "Content-Length": contentLength,
            "Content-Type": "video/mp4",
        };
        const bucket = new mongodb.GridFSBucket(db, { bucketName: COLLECTION_VENDOR_REELS });
        dbg('found video', video.filename);
        const downloadStream = bucket.openDownloadStreamByName(video.filename, {
            start
        });
        res.code(206).headers(headers).send(downloadStream);
    });
}

async function watchReelsHtmlAsync(request) {
    return `<!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>HTML Admin Video</title>
      </head>
      <body>
        <video style="text-align:center;width:512px" controls muted="muted" autoplay>
          <source src="/admin/reels/watch?uuid=${request.query.uuid}&access_token=${request.query.access_token}" type="video/mp4" />
        </video>
      </body>
    </html>`;
}

async function likeReelsAsync(request) {

    if (!request.body.uuid || !request.body.like)
        return error('invalid uuid/like');

    let uuid = String(request.body.uuid);

    let reel = await mongoService.findOneAsync(COLLECTION_VENDOR_REELS.concat('.files'), {
        'metadata.uuid': uuid,
        'metadata.approved': true
    });

    if (!reel)
        return error("not found or approved reel", { uuid });

    let like = String(request.body.like) == 'true';

    await saveAsync({
        collection: COLLECTION_REELS_LIKES,
        index: {
            uuid,
            username: request.user.username
        },
        item: {
            like,
            doneAt: Date.now()
        }
    });

    return success("ok", { like });
}

async function likesReelsAsync(request) {

    if (!request.body.uuid)
        return error('invalid uuid/like');

    let uuid = String(request.body.uuid);
    let { page, pageSize } = getPagingParams(request);

    let filter = {
        uuid,
        like: true
    };

    if (request.body.username) {
        filter.username = String(request.body.username);
    }

    return findAsync({
        collection: COLLECTION_REELS_LIKES,
        filter,
        page,
        pageSize,
        sort: {
            doneAt: -1
        }
    });
}

function init(fastify) {

    dbg('init: reels-service');

    // vendor upload - delete
    fastify.post('/vendors/reels/upload', funcScopedAsync(uploadReelAsync, SCOPE_VENDOR));
    fastify.post('/vendors/reels/delete', funcScopedAsync(deleteReelAsync, SCOPE_VENDOR));
    fastify.post('/vendors/reels/find', funcScopedAsync(findVendorReelsAsync, SCOPE_VENDOR));
    fastify.get('/vendors/reels/watch', funcScoped(watchVendorReels, SCOPE_USER));

    // admin find, approve, watch
    fastify.post('/admin/reels/find', funcScopedAsync(findReelsAsync, SCOPE_ADMIN));
    fastify.post('/admin/reels/approve', funcScopedAsync(approveReelAsync, SCOPE_ADMIN));
    fastify.get('/admin/reels/watch', funcScoped(watchReels, SCOPE_ADMIN));
    fastify.get('/admin/reels/watch.html', funcHTMLAsync(watchReelsHtmlAsync));

    // user watch
    fastify.post('/user/reels/find', funcAsync(findPublicReelsAsync));
    fastify.get('/user/reels/watch', funcStream(watchPublicReels));

    // user like
    fastify.post('/user/reels/like', funcScopedAsync(likeReelsAsync));
    fastify.post('/user/reels/likes', funcScopedAsync(likesReelsAsync));

}

module.exports = {
    init
};