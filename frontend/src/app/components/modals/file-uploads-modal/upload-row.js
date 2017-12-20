/* Copyright (C) 2016 NooBaa */

import ko from 'knockout';
import numeral from 'numeral';
import { deepFreeze } from 'utils/core-utils';
import { formatSize } from 'utils/size-utils';
import { realizeUri } from 'utils/browser-utils';
import * as routes from 'routes';

const errorCodeToProgressText = deepFreeze({
    NoSuchUpload: 'ABORTED'
});

function _getProgress(upload) {
    const { completed, error, size, loaded } = upload;

    if (completed) {
        if (error) {
            return {
                text: errorCodeToProgressText[error.code] || 'FAILED',
                tooltip: error.message,
                css: 'error'
            };
        } else {
            return {
                text: 'COMPLETED',
                css: 'success'
            };
        }
    } else {
        return {
            text: (size > 0 ? numeral(loaded/size).format('%') : 0)
        };
    }
}

export default class UploadRowViewModel {
    constructor() {
        this.fileName = ko.observable();
        this.bucketName = ko.observable();
        this.size = ko.observable();
        this.progress = ko.observable();
    }

    update(upload, system) {
        const { name, bucket, completed, error, size } = upload;
        const fileNameData = {
            text: name,
            tooltip: {
                text: name,
                breakWords: true
            }
        };

        if (completed && !error) {
            fileNameData.href = realizeUri(routes.object, {
                system,
                bucket,
                object: name
            });
        }

        this.fileName(fileNameData);
        this.bucketName(bucket);
        this.size(formatSize(size));
        this.progress(_getProgress(upload));

        return this;
    }
}
