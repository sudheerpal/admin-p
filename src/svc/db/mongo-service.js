const {
    dbg, dbgErr
} = require('../utils/debug-service');

let mongo = require('mongodb');
const { Duplex } = require('stream');
const base64 = require('base-64');
const { COLLECTION_VENDOR_REELS } = require('../../proto/collections');

let url = process.env.MONGO_URL;
let MongoClient = mongo.MongoClient;

let mongodb = null;

function asyncResult(res, rej) {
    return (e, r) => {
        if (e) {
            rej(e);
        } else {
            res(r);
        }
    };
}

function collection(name) {
    return mongodb.db(process.env.MONGO_DB).collection(name);
}

async function findOneAsync(collexion, filter, fields) {
    return await
        collection(collexion)
            .findOne(filter, fields || {
                projection: {
                    "_id": 0
                }
            });
}

function findArrayAsync(collexion, filter, sort, skip, limit, fields) {
    return new Promise((res, rej) => {
        collection(collexion)
            .find(filter, fields || {
                projection: {
                    "_id": 0
                }
            }).sort(sort || {})
            .skip(skip || 0)
            .limit(limit || 0)
            .collation({
                locale: "en_US",
                numericOrdering: true
            })
            .toArray(asyncResult(res, rej));
    });
}

function aggregateAsync(collexion, matchGroup) {
    return new Promise((res, rej) => {
        collection(collexion)
            .aggregate(matchGroup)
            .toArray(asyncResult(res, rej));
    });
}


function insertOrUpdateAsync(collexion, index, item, options) {
    return new Promise((res, rej) => {
        collection(collexion).updateOne(index, item, options, asyncResult(res, rej));
    });
}

function deleteAsync(collexion, filter) {
    return new Promise((res, rej) => {
        collection(collexion).deleteMany(filter, asyncResult(res, rej));
    });
}

function countAsync(collexion, filter) {
    return new Promise((res, rej) => {
        res(collection(collexion).find(filter).count());
    });
}

function countAllAsync(collexion) {
    return new Promise((res, rej) => {
        res(collection(collexion).countDocuments());
    });
}

function connectAsync() {
    return new Promise((res, rej) => {
        dbg('connecting to mongodb...');
        MongoClient
            .connect(url, {
                maxPoolSize: 4,
                wtimeoutMS: 2500,
                useNewUrlParser: true,
                useUnifiedTopology: true
            })
            .then((db) => {
                dbg('connected to mongodb');
                mongodb = db;
                res(true);
            })
            .catch((err) => {
                dbg('error creating mongodb connection, retrying...', err);
                res(false);
            });
    });
}

async function waitAsync(ms) {
    return new Promise((res, rej) => {
        setTimeout(() => res(), ms || 5000);
    });
}

async function dbInitAsync() {
    do {
        dbg('init: mongo-service');
        await waitAsync();
    } while (await connectAsync() !== true);
}

function bufferToStream(buff) {
    let tmp = new Duplex();
    tmp.push(buff);
    tmp.push(null);
    return tmp;
}

async function fsGetImageAsync(filename) {
    try {
        const db = mongodb.db(process.env.MONGO_DB);
        const collexion = collection('fs.files');
        const image = await collexion.findOne({ filename: filename });

        if (!image || !image.metadata) {
            return null;
        }

        const bucket = new mongo.GridFSBucket(db);
        const imageChunks = [];

        const imageStream = bucket.openDownloadStream(image._id);
        for await (const chunk of imageStream) {
            imageChunks.push(chunk);
        }

        const base64Image = Buffer.concat(imageChunks).toString('base64');
        return `data:${image.metadata.contentType};base64,${base64Image}`;
    } catch (e) {
        dbgErr('error getting image', e);
        return null;
    }
}

async function fsDelImageAsync(filename) {
    let files = await findArrayAsync('fs.files', {
        filename
    }, undefined, undefined, undefined, { projection: { _id: 1 } });
    for (const file of files) {
        await deleteAsync('fs.chunks', {
            files_id: mongo.ObjectId.createFromHexString(String(file._id))
        });
        await deleteAsync('fs.files', {
            _id: mongo.ObjectId.createFromHexString(String(file._id))
        });
    }
}

async function fsPutImageAsync(filename, imageBase64URI) {
    return new Promise((res, rej) => {
        const db = mongodb.db(process.env.MONGO_DB);
        const bucket = new mongo.GridFSBucket(db);
        const dataParts = imageBase64URI.split(',');
        const dataHeader = dataParts[0];
        const dataBody = dataParts[1];
        const contentType = dataHeader.split(';')[0].split(':')[1];
        const buffer = Buffer.from(dataBody, 'base64');
        const metadata = { contentType };
        const uploadStream = bucket.openUploadStream(filename, { metadata });
        uploadStream.write(buffer);
        uploadStream.end((err) => {
            if (err) {
                rej(err);
            } else {
                res(true);
            }
        });
    });
}

async function fsPutReelAsync(file, metadata = {}) {
    const db = mongodb.db(process.env.MONGO_DB);
    const bucket = new mongo.GridFSBucket(db, { bucketName: COLLECTION_VENDOR_REELS });
    const videoUploadStream = bucket.openUploadStream(file.name, {
        chunkSizeBytes: 1048576,
        metadata
    });
    bufferToStream(file.data)
        .pipe(videoUploadStream);
}

module.exports = {
    initAsync: dbInitAsync,
    db: () => mongodb.db(process.env.MONGO_DB),
    aggregateAsync,
    findArrayAsync,
    insertOrUpdateAsync,
    deleteAsync,
    countAsync,
    findOneAsync,
    fsPutReelAsync,
    fsPutImageAsync,
    fsGetImageAsync,
    fsDelImageAsync,
    countAllAsync
};