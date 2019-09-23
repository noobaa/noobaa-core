/* Copyright (C) 2016 NooBaa */

import { Subject } from 'rxjs';
import { mergeMap } from 'rxjs/operators';
import { ofType } from 'rx-extensions';
import { mapErrorObject } from 'utils/state-utils';
import { UPLOAD_SSL_CERTIFICATE } from 'action-types';
import {
    updateUploadSSLCertificate,
    completeUploadSSLCertificate,
    failUploadSSLCertificate,
    openCompleteSSLCertificateInstallationModal
} from 'action-creators';

async function _initiateUpload(uploadEvent$, certPkg, browser) {
    try {
        const xhr = new browser.XMLHttpRequest();
        xhr.upload.onprogress = evt => {
            const progress = evt.lengthComputable && (evt.loaded / evt.total);
            uploadEvent$.next(updateUploadSSLCertificate(progress));
        };

        const evt = await browser.httpRequest('/upload_certificate', {
            verb: 'POST',
            xhr,
            payload: browser.toFormData({ upload_file: certPkg })
        });

        if (evt.target.status !== 200) {
            throw new Error(`${evt.target.responseText}`);
        }

        uploadEvent$.next(completeUploadSSLCertificate());
        uploadEvent$.next(openCompleteSSLCertificateInstallationModal());

    } catch (error) {
        uploadEvent$.next(failUploadSSLCertificate(mapErrorObject(error)));

    } finally {
        uploadEvent$.complete();
    }
}

export default function(action$, { bufferStore, browser }) {
    return action$.pipe(
        ofType(UPLOAD_SSL_CERTIFICATE),
        mergeMap(action => {
            const { certBufferKey } = action.payload;
            const certPkg = new Blob([bufferStore.get(certBufferKey)]);
            const uploadEvent$ = new Subject();

            _initiateUpload(uploadEvent$, certPkg, browser);

            return uploadEvent$;
        })
    );
}

