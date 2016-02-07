import template from './cloud-sync-modal.html';
import ko from 'knockout';

class CloudSyncModalViewModel {
    constructor({ bucketName, onClose }) {
        this.bucketName = bucketName;
        this.onClose = onClose;

        this.accessKey = ko.observable();
        this.secretKey = ko.observable();
        this.awsBucket = ko.observable();
        this.syncType = ko.observable('BI');
        this.syncDeletions = ko.observable(false);
        this.syncCycle = ko.observable('1');
        this.syncCycleUnit = ko.observable('HOURS')
    }

    cancel() {
        this.onClose();
    }

    save() {
        this.onClose();
    }
}

export default {
    viewModel: CloudSyncModalViewModel,
    template: template
}