/* Copyright (C) 2016 NooBaa */

import { Subject } from 'rx';
import { UPLOAD_UPGRADE_PACKAGE, ABORT_UPGRADE_PACKAGE_UPLOAD } from 'action-types';
import { toFormData } from 'utils/browser-utils';
import { updateUpgradePackageUpload } from 'action-creators';

export default function(action$, { browser }) {
    return action$
        .ofType(UPLOAD_UPGRADE_PACKAGE)
        .flatMap(action => {
            const { packageFile }  = action.payload;

            const upload$ = new Subject();
            const xhr = new XMLHttpRequest();
            xhr.upload.onprogress = evt => {
                const { lengthComputable, loaded, total } = evt;
                const progress = lengthComputable ? (loaded / total) : 0;
                upload$.onNext(updateUpgradePackageUpload(progress));
            };

            browser.httpRequest('/upgrade', {
                verb: 'POST',
                xhr: xhr,
                payload: toFormData({
                    upgrade_file: packageFile
                })
            }).then(
                () => upload$.onCompleted(),
                () => upload$.onCompleted()
            );

            // Side effect that aborts the xhr request
            // when an ABORT_UPGRADE_PACKAGE_UPLOAD is accepted
            // while the upload event stream is still opened.
            action$
                .ofType(ABORT_UPGRADE_PACKAGE_UPLOAD)
                .takeUntil(upload$.takeLast(1))
                .subscribe(() => { xhr.abort(); });

            return upload$;
        });
}
