import template from './s3-access-details-modal.html';
import BaseViewModel from 'base-view-model';
import ko from 'knockout';
import { systemInfo, accountInfo } from 'model';
import { loadAccountInfo } from 'actions';
import { noop, copyTextToClipboard } from 'utils';

class S3AccessDetailsModalViewModel extends BaseViewModel {
    constructor({ account, onClose = noop }) {
        super();

        this.onClose = onClose;

        let endpoint = ko.pureComputed(
            () => systemInfo() && systemInfo().endpoint
        );

        let keys = ko.pureComputed(
            () => accountInfo() && accountInfo().access_keys[0]
        );

        let accessKey = ko.pureComputed(
            () => keys() && keys().access_key
        );

        let secretKey = ko.pureComputed(
            () => keys() && keys().secret_key
        );

        this.details = [
            { label: 'Storage Type', value: 'S3 Compatible Storage', allowCopy: false },
            { label: 'Endpoint', value: endpoint, allowCopy: true },
            { label: 'Access Key', value: accessKey, allowCopy: true },
            { label: 'Secret Key', value: secretKey, allowCopy: true }
        ];

        loadAccountInfo(ko.unwrap(account));
    }

    copyToClipboard(text) {
        copyTextToClipboard(ko.unwrap(text));
    }

    close() {
        this.onClose();
    }
}

export default {
    viewModel: S3AccessDetailsModalViewModel,
    template: template
};
