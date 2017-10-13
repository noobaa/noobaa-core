/* Copyright (C) 2016 NooBaa */

import ko from 'knockout';
import numeral from 'numeral';
import { formatSize } from 'utils/size-utils';
import { realizeUri } from 'utils/browser-utils';
import * as routes from 'routes';

export default class UploadRowViewModel {
    constructor() {
        this.fileName = ko.observable();
        this.bucketName = ko.observable();
        this.size = ko.observable();
        this.progress = ko.observable();
    }

    update(upload, system) {
        const { name, bucket, completed, error, size, loaded } = upload;
        const progressText = completed ?
            (error ? 'FAILED' : 'UPLOADED') :
            (size > 0 ? numeral(loaded/size).format('%') : 0);

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
        this.progress({
            text: progressText,
            tooltip: error,
            css: error ? 'error' : (completed ? 'success' : '')
        });

        return this;
    }
}
