/* Copyright (C) 2016 NooBaa */

import Rx from 'rx';
import { DELETE_OBJECT } from 'action-types';
import { completeDeleteObject, failDeleteObject } from 'action-creators';

export default function(action$, { S3 }) {
    return action$
        .ofType(DELETE_OBJECT)
        .flatMap(action => {
            const { bucket, key, uploadId, accessData } = action.payload;
            const { endpoint, accessKey, secretKey } = accessData;
            const s3 = new S3({
                endpoint: endpoint,
                credentials: {
                    accessKeyId: accessKey,
                    secretAccessKey: secretKey
                },
                s3ForcePathStyle: true,
                sslEnabled: false
            });
            const deleteEvent$ = new Rx.Subject();


            if (uploadId) {
                const params = {
                    Bucket: bucket,
                    Key: key,
                    UploadId: uploadId
                };

                s3.abortMultipartUpload(params, error => {
                    deleteEvent$.onNext(error ?
                        failDeleteObject(bucket, key, uploadId, error) :
                        completeDeleteObject(bucket, key, uploadId)
                    );
                });
            } else {
                const params = {
                    Bucket: bucket,
                    Key: key
                };

                s3.deleteObject(params, error => {
                    deleteEvent$.onNext(error ?
                        failDeleteObject(bucket, key, uploadId, error) :
                        completeDeleteObject(bucket, key, uploadId)
                    );
                });
            }

            return deleteEvent$;
        });
}
