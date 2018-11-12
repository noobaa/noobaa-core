/* Copyright (C) 2016 NooBaa */

export function getObjectId(bucket, key, versionId, uploadId) {
    return uploadId ?
        `${bucket}:${key}:${versionId}:${uploadId}` :
        `${bucket}:${key}:${versionId}`;
}

export function splitObjectId(objId) {
    const [bucket, key, version, uploadId ] = objId.split(':');
    return { bucket, key, version, uploadId };
}

export function formatVersionId(versionId) {
    return versionId === 'null' ? 'Null' : versionId;
}
