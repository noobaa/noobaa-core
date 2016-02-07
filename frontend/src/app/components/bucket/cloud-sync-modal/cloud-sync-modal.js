import template from './cloud-sync-modal.html';
import ko from 'knockout';
import { loadCloudSyncPolicy } from 'actions';

const syncUnitsOptions = [
	{ value: 'BI', label: 'Bi-Direcitonal' },
	{ value: 'NB2AWS', label: 'NooBaa to AWS' },
	{ value: 'AWS2NB', label: 'AWS to NooBaa' }
];

class CloudSyncModalViewModel {
<<<<<<< HEAD
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
=======
	constructor({ bucketName, onClose }) {
		this.syncUnitsOptions =syncUnitsOptions;

		this.bucketName = bucketName;
		this.onClose = onClose;



		this.accessKey = ko.observable();
		this.secretKey = ko.observable();
		this.awsBucket = ko.observable();
		this.syncType = ko.observable('BI');
		this.syncDeletions = ko.observable(false);
		this.syncCycle = ko.observable('1');
		this.syncCycleUnit = ko.observable('HOURS')

		loadCloudSyncPolicy(ko.unwrap(this.bucketName));
	}
>>>>>>> 5899a610afcb3d598d4507eb1f86f1bfdcc9a9cb

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