/* Copyright (C) 2016 NooBaa */

import Rx from 'rx';
import { ABORT_OBJECT_UPLOAD } from 'action-types';
import { createS3Client } from 'utils/s3-utils';
import { completeAbortObjectUpload, failAbortObjectUpload } from 'action-creators';

const endpoint = global.location.hostname;

export default function(action$, { S3 }) {
    return action$
        .ofType(ABORT_OBJECT_UPLOAD)
        .flatMap(action => {
            const { bucket, object, objId, accessKey, secretKey } = action.payload;
            const s3 = createS3Client(S3, endpoint, accessKey, secretKey);
            const abortEvent$ = new Rx.Subject();
            const params = {
                Bucket: bucket,
                Key: object,
                UploadId: objId
            };

            s3.abortMultipartUpload(params, error => {
                abortEvent$.onNext(error ?
                    failAbortObjectUpload(bucket, object, objId, error) :
                    completeAbortObjectUpload(bucket, object, objId)
                );
            });

            return abortEvent$;
        });
}
