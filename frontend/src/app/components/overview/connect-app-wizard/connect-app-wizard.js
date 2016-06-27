import template from './connect-app-wizard.html';
import selectSlideTemplate from './select-slide.html';
import connecSlideTemplate from './connect-slide.html';
import ko from 'knockout';
import { systemInfo, accountList } from 'model';
import { loadAccountList } from 'actions';

const connectionTypes = Object.freeze([
    {
        type: 'NATIVE',
        label: 'Native Access',
        description: 'A REST based protocal commonly used by S3 compatible clients (e.g. S3 Browser)'
    },
    {
        type: 'FS',
        label: 'Linux File Access (Using Fuse)',
        description: 'Coming Soon...',
        disabled: true
    },
    {
        type: 'HDFS',
        label: 'Big Data Access (HDFS)',
        description: 'Coming Soon...',
        disabled: true
    }
]);

class ConnectApplicationWizard {
    constructor({ onClose }) {
        this.onClose = onClose;
        this.selectSlideTemplate = selectSlideTemplate;
        this.connectSlideTemplate = connecSlideTemplate;

        this.conTypes = connectionTypes;
        this.selectedConType = ko.observable(this.conTypes[0]);

        this.accountOptions = accountList.map(
            account => ({ label: account.email, value: account })
        );

        this.selectedAccount = ko.observableWithDefault(
            () => systemInfo() && accountList() && accountList().filter(
                account => account.email === systemInfo().owner.email
            )[0]
        );

        let keys = ko.pureComputed(
            () => this.selectedAccount() && this.selectedAccount().access_keys[0]
        );

        this.details = [
            {
                label: 'Storage Type',
                value: 'S3 compatible storage'
            },
            {
                label: 'REST Endpoint',
                value: ko.pureComputed(
                    () => systemInfo() && systemInfo().endpoint
                ),
                allowCopy: true
            },
            {
                label: 'Access Key',
                value: ko.pureComputed(
                    () => keys() && keys().access_key
                ),
                allowCopy: true
            },
            {
                label: 'Secret Key',
                value: ko.pureComputed(
                    () => keys() && keys().secret_key
                ),
                allowCopy: true
            }
        ];

        loadAccountList();
    }
}

export default {
    viewModel: ConnectApplicationWizard,
    template: template
};
