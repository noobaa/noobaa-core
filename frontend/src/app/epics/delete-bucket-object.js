/* Copyright (C) 2016 NooBaa */

import Rx from 'rx';
import { DELETE_BUCKET_OBJECT } from 'action-types';
import { createS3Client } from 'utils/s3-utils';
import { completeDeleteBucketObject, failDeleteBucketObject } from 'action-creators';

const endpoint = global.location.hostname;

export default function(action$, { S3 }) {
    return action$
        .ofType(DELETE_BUCKET_OBJECT)
        .flatMap(action => {
            const { bucket, object, accessKey, secretKey } = action.payload;
            const s3 = createS3Client(S3, endpoint, accessKey, secretKey);
            const deleteEvent$ = new Rx.Subject();

            var params = {
                Bucket: bucket,
                Key: object
            };

            s3.deleteObject(params, error => {
                deleteEvent$.onNext(error ?
                    failDeleteBucketObject(bucket, object, error) :
                    completeDeleteBucketObject(bucket, object)
                );
            });

            return deleteEvent$;
        });
}
