/* Copyright (C) 2016 NooBaa */

import { mergeMap } from 'rxjs/operators';
import { ofType } from 'rx-extensions';
import { Subject } from 'rxjs';
import { createS3Client } from 'utils/aws-utils';
import { mapErrorObject } from 'utils/state-utils';
import { DELETE_OBJECT } from 'action-types';
import { completeDeleteObject, failDeleteObject } from 'action-creators';

export default function(action$, { AWS }) {
    return action$.pipe(
        ofType(DELETE_OBJECT),
        mergeMap(action => {
            const { objId, accessData } = action.payload;
            const { bucket, key, version, uploadId } = objId;
            const s3 = createS3Client(AWS, accessData);
            const deleteEvent$ = new Subject();

            if (uploadId) {
                const params = {
                    Bucket: bucket,
                    Key: key,
                    UploadId: uploadId
                };

                s3.abortMultipartUpload(params, error => {
                    deleteEvent$.next(error ?
                        failDeleteObject(objId, mapErrorObject(error)) :
                        completeDeleteObject(objId)
                    );
                });
            } else {
                const params = {
                    Bucket: bucket,
                    Key: key,
                    VersionId: version
                };

                s3.deleteObject(params, error => {
                    deleteEvent$.next(error ?
                        failDeleteObject(objId, mapErrorObject(error)) :
                        completeDeleteObject(objId)
                    );
                });
            }

            return deleteEvent$;
        })
    );
}
