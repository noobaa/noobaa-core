/* Copyright (C) 2016 NooBaa */

import { randomString } from 'utils/string-utils';
import { dispatch } from 'state-actions';
import AWS from 'services/aws';
import { deepFreeze } from 'utils/core-utils';

const s3UploadOptions = deepFreeze({
    partSize: 64 * 1024 * 1024,
    queueSize: 4
});

export function uploadObjects(bucket, files, accessKey, secretKey) {
    const time = Date.now();
    const objects = Array.from(files).map(file => ({
        id: randomString(),
        bucket,
        file
    }));

    dispatch({ type: 'OBJECT_UPLOAD_STARTED', time, objects });

    const s3 = createS3Client(global.location.hostname, accessKey, secretKey);
    for (const { id, bucket, file } of objects) {

        s3.upload(
            {
                Key: file.name,
                Bucket: bucket,
                Body: file,
                ContentType: file.type
            },
            s3UploadOptions,
            error => error ?
                dispatch({ type: 'OBJECT_UPLOAD_FAIELD', id, error }) :
                dispatch({ type: 'OBJECT_UPLOAD_COMPLETED', id })
        )
        .on(
            'httpUploadProgress',
            ({ loaded }) => dispatch({ type: 'OBJECT_UPLOAD_PROGRESS', id, loaded })
        );
    }
}

export function clearCompletedObjectUploads() {
    dispatch({ type: 'CLEAR_COPLETED_OBJECT_UPLOADES' });
}

function createS3Client(endpoint, accessKey, secretKey) {
    return new AWS.S3({
        endpoint: endpoint,
        credentials: {
            accessKeyId: accessKey,
            secretAccessKey: secretKey
        },
        s3ForcePathStyle: true,
        sslEnabled: false
    });
}
