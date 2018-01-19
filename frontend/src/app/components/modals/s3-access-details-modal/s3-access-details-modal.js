/* Copyright (C) 2016 NooBaa */

import template from './s3-access-details-modal.html';
import ko from 'knockout';
import { closeModal } from 'action-creators';
import { action$ } from 'state';
import { copyTextToClipboard } from 'utils/browser-utils';

class S3AccessDetailsModalViewModel {
    details = null;

    constructor({ endpoint, accessKey, secretKey }) {
        this.details = [
            { label: 'Storage Type', value: 'S3 Compatible Storage', allowCopy: false },
            { label: 'Endpoint', value: endpoint, allowCopy: true },
            { label: 'Access Key', value: accessKey, allowCopy: true },
            { label: 'Secret Key', value: secretKey, allowCopy: true }
        ];
    }

    copyToClipboard(text) {
        copyTextToClipboard(ko.unwrap(text));
    }

    close() {
        action$.onNext(closeModal());
    }
}

export default {
    viewModel: S3AccessDetailsModalViewModel,
    template: template
};
