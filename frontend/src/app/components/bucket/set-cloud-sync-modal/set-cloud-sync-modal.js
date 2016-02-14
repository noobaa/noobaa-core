import template from './set-cloud-sync-modal.html';
import ko from 'knockout';
import { awsCredentialsList, awsBucketList } from 'model';
import { loadAccountAwsCredentials, loadAwsBucketList, setCloudSyncPolicy } from 'actions';

const [ MIN, HOUR, DAY ] = [1, 60, 60 * 24];
const frequencyUnitOptions = Object.freeze([
     { value: MIN, label: 'Minutes' },
     { value: HOUR, label: 'Hours' },
     { value: DAY, label: 'Days' }
]);

const directionOptions = Object.freeze([
    { value: 'BI', label: 'Bi-Direcitonal' },
    { value: 'NB2AWS', label: 'NooBaa to AWS' },
    { value: 'AWS2NB', label: 'AWS to NooBaa' }
]);

const addAccessKeyOption = {
    label: 'Add new access key',
    value: 'NEW_KEY'
};

// awsCredentialsList.push(
//     { access_key: 'AKIAJOP7ZFXOOPGL5BOA', secret_key: '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' },
//     { access_key: 'AKIAIKFRM4EAAO5TAXJA', secret_key: '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' }
// );

class CloudSyncModalViewModel {
    constructor({ bucketName, onClose }) {
        this.onClose = onClose;
        this.bucketName = bucketName;

        this.accessKeyOptions = ko.pureComputed(
            () => [
                addAccessKeyOption,
                null,
                ...awsCredentialsList().map(
                    ({ access_key }) => ({ value: access_key })
                )
            ]
        );

        //let _accessKey = ko.observable();
        // this.accessKey = ko.pureComputed(
        // );

        this.accessKey = ko.observable();
        this.accessKey.subscribe(
            accessKey => accessKey === 'NEW_KEY' && 
                this.isAWSCredentialsModalVisible(true)
        );

        this.awsCredentials = ko.pureComputed(
            () => awsCredentialsList().find(
                ({ access_key }) => access_key === this.accessKey()
            )
        );
        this.awsCredentials.subscribe(
            credentials => credentials && this.loadBucketsList()
        );

        this.awsBucket = ko.observable();
        this.awsBucketsOptions = awsBucketList.map(
            bucketName => ({ value: bucketName })
        );

        this.direction = ko.observable('BI');
        this.directionOptions = directionOptions;

        this.frequency = ko.observable(1);
        this.frequencyUnit = ko.observable(HOUR);
        this.frequencyUnitOptions = frequencyUnitOptions; 
        
        let _syncDeletions = ko.observable(true);
        this.syncDeletions = ko.pureComputed({
            read: () => this.direction() === 'BI' ? true : _syncDeletions(),
            write: _syncDeletions 
        });

        this.isAWSCredentialsModalVisible = ko.observable(false);

        loadAccountAwsCredentials();
    }

    loadBucketsList() {
        let { access_key, secret_key } = this.awsCredentials(); 
        loadAwsBucketList(access_key, secret_key);
    }


    cancel() {
        this.onClose();
    }

    save() {
        setCloudSyncPolicy(
            ko.unwrap(this.bucketName),
            this.awsBucket(),
            this.awsCredentials(),
            this.direction(),
            this.frequency() * this.frequencyUnit(),
            this.syncDeletions()
        );
        this.onClose();
    }
}

export default {
    viewModel: CloudSyncModalViewModel,
    template: template
}