import template from './connect-app-wizard.html';
import selectConnectionSlideTemplate from './select-connection.html';
import selectAccountSlideTemplate from './select-account.html';
import Disposable from 'disposable';
import ko from 'knockout';
import { systemInfo } from 'model';
import { deepFreeze } from 'utils';

const steps = deepFreeze([
    'select connection',
    'select account'
]);

const connectionTypes = deepFreeze([
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

class ConnectApplicationWizardViewModel extends Disposable {
    constructor({ onClose }) {
        super();

        this.onClose = onClose;
        this.steps = steps;
        this.selectConnectionSlideTemplate = selectConnectionSlideTemplate;
        this.selectAccountSlideTemplate = selectAccountSlideTemplate;

        this.conTypes = connectionTypes;
        this.selectedConType = ko.observable(this.conTypes[0]);

        let accounts = ko.pureComputed(
            () => systemInfo() ? systemInfo().accounts : []
        );

        this.accountOptions = ko.pureComputed(
            () => accounts().map(
                account => ({
                    label: account.email,
                    value: account
                })
            )
        );

        this.selectedAccount = ko.observableWithDefault(
            () => systemInfo() && accounts().filter(
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
    }
}

export default {
    viewModel: ConnectApplicationWizardViewModel,
    template: template
};
