import template from './s3-access-details-modal.html';
import BaseViewModel from 'components/base-view-model';
import ko from 'knockout';
import { systemInfo } from 'model';
import { noop } from 'utils/core-utils';
import { copyTextToClipboard } from 'utils/browser-utils';

class S3AccessDetailsModalViewModel extends BaseViewModel {
    constructor({ email, onClose = noop }) {
        super();

        this.onClose = onClose;

        let account = ko.pureComputed(
            () => systemInfo() && systemInfo().accounts.find(
                account => account.email === ko.unwrap(email)
            )
        );

        let endpoint = ko.pureComputed(
            () => systemInfo() && systemInfo().endpoint
        );

        let keys = ko.pureComputed(
            () => account() && account().access_keys[0]
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
