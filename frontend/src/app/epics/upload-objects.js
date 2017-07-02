/* Copyright (C) 2016 NooBaa */

import Rx from 'rx';
import { UPLOAD_OBJECTS } from 'action-types';
import { updateObjectUpload, completeObjectUpload, failObjectUpload } from 'action-creators';
import { deepFreeze } from 'utils/core-utils';

const endpoint = global.location.hostname;
const s3UploadOptions = deepFreeze({
    partSize: 64 * 1024 * 1024,
    queueSize: 4
});

export default function(action$, { S3 }) {
    return action$
        .ofType(UPLOAD_OBJECTS)
        .flatMap(action => {
            const { objects, accessKey, secretKey } = action.payload;
            const s3 = _createS3Client(S3, endpoint, accessKey, secretKey);
            const uploadEvent$ = new Rx.Subject();

            let uploading = objects.length;
            for (const { id, bucket, file } of objects) {
                s3.upload(
                    {
                        Key: file.name,
                        Bucket: bucket,
                        Body: file,
                        ContentType: file.type
                    },
                    s3UploadOptions,
                    error => {
                        uploadEvent$.onNext(
                            error ? failObjectUpload(id, error) : completeObjectUpload(id)
                        );

                        if (--uploading == 0) {
                            uploadEvent$.onCompleted();
                        }
                    }
                )
                .on(
                    'httpUploadProgress',
                    ({ loaded }) => uploadEvent$.onNext(updateObjectUpload(id, loaded))
                );
            }

            return uploadEvent$;
        });
}

function _createS3Client(S3, endpoint, accessKey, secretKey) {
    return new S3({
        endpoint: endpoint,
        credentials: {
            accessKeyId: accessKey,
            secretAccessKey: secretKey
        },
        s3ForcePathStyle: true,
        sslEnabled: false
    });
}
