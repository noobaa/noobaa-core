import { deepFreeze } from 'utils/core-utils';
import { randomString } from 'utils/string-utils';
import { dispatch } from 'state-actions';
import AWS from 'services/aws';

export function uploadFiles(bucket, files) {
    const s3 = createS3Client(window.location.hostname, '123', 'abc');

    for (const file of files) {
        const id = randomString();
        const time = Date.now();
        dispatch({ type: 'OBJECT_UPLOAD_STARTED', id, bucket, file, time });

        s3.upload(
            {
                Key: file.name,
                Bucket: bucket,
                Body: file,
                ContentType: file.type
            },
            {
                partSize: 64 * 1024 * 1024,
                queueSize: 4
            },
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
