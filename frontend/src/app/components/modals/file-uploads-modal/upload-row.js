/* Copyright (C) 2016 NooBaa */

import ko from 'knockout';
import numeral from 'numeral';
import { formatSize } from 'utils/size-utils';

export default class UploadRowViewModel {
    constructor() {
        this.fileName = ko.observable();
        this.bucketName = ko.observable();
        this.size = ko.observable();
        this.progress = ko.observable();
    }

    update(upload) {
        const { name, bucket, completed, error, size, loaded } = upload;
        const progressText = completed ?
            (error ? 'FAILED' : 'UPLOADED') :
            numeral(loaded/size).format('%');

        this.fileName(name);
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
