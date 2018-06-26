/* Copyright (C) 2016 NooBaa */

import { Subject } from 'rxjs';
import { mergeMap } from 'rxjs/operators';
import { ofType } from 'rx-extensions';
import { UPLOAD_OBJECTS } from 'action-types';
import { deepFreeze } from 'utils/core-utils';
import { mapErrorObject } from 'utils/state-utils';
import { createS3Client } from 'utils/s3-utils';
import { unitsInBytes } from 'utils/size-utils';
import {
    updateObjectUpload,
    completeObjectUpload,
    completeObjectsUpload,
    failObjectUpload
} from 'action-creators';

const uploads = [];
const s3UploadOptions = deepFreeze({
    partSize: 10 * unitsInBytes.MB,
    queueSize: 4
});

export default function(action$, { S3 }) {
    return action$.pipe(
        ofType(UPLOAD_OBJECTS),
        mergeMap(action => {
            const { objects, connection } = action.payload;
            const { endpoint, accessKey, secretKey } = connection;
            const s3 = createS3Client(S3, endpoint, accessKey, secretKey);
            const uploadEvent$ = new Subject();

            let uploading = objects.length;
            for (const { id, bucket, file } of objects) {
                const upload = {
                    isCompleted: false,
                    isError: false
                };

                uploads.push(upload);

                s3.upload(
                    {
                        Key: file.name,
                        Bucket: bucket,
                        Body: file,
                        ContentType: file.type
                    },
                    s3UploadOptions,
                    error => {
                        const action = error ?
                            failObjectUpload(id, file.name, mapErrorObject(error)) :
                            completeObjectUpload(id);

                        uploadEvent$.next(action);
                        upload.isCompleted = true;
                        upload.isError = Boolean(error);

                        if (--uploading == 0) {

                            const allCompleted = uploads
                                .every(({ isCompleted }) => isCompleted);

                            if (allCompleted) {
                                const successCount = uploads
                                    .filter(({ isError }) => !isError).length;

                                successCount && uploadEvent$.next(completeObjectsUpload(successCount));
                                uploads.length = 0;
                            }

                            uploadEvent$.complete();
                        }
                    }
                ).on(
                    'httpUploadProgress',
                    ({ loaded }) => uploadEvent$.next(updateObjectUpload(id, loaded))
                );
            }

            return uploadEvent$;
        })
    );
}
