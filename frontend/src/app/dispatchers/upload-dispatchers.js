/* Copyright (C) 2016 NooBaa */

import { randomString } from 'utils/string-utils';
import { dispatch } from 'state-actions';
import AWS from 'services/aws';
import { deepFreeze } from 'utils/core-utils';
import { START_OBJECT_UPLOAD, FAIL_OBJECT_UPLOAD, COMPLETE_OBJECT_UPLOAD,
    UPDATE_OBJECT_UPLOAD, CLEAR_COMPLETED_OBJECT_UPLOADES } from 'action-types';

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

    dispatch({
        type: START_OBJECT_UPLOAD,
        payload: { time, objects }
    });

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
                dispatch({
                    type: FAIL_OBJECT_UPLOAD,
                    payload: { id, error }
                }) :
                dispatch({
                    type: COMPLETE_OBJECT_UPLOAD,
                    payload: { id }
                })
        )
        .on(
            'httpUploadProgress',
            ({ loaded }) => dispatch({
                type: UPDATE_OBJECT_UPLOAD,
                payload: { id, loaded }
            })
        );
    }
}

export function clearCompletedObjectUploads() {
    dispatch({ type: CLEAR_COMPLETED_OBJECT_UPLOADES });
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
