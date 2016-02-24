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
    
    value: 'NEW_KEY'
};

class CloudSyncModalViewModel {
    constructor({ bucketName, onClose }) {
        this.onClose = onClose;
        this.bucketName = bucketName;

        this.accessKeyOptions = ko.pureComputed(
            () => [
                {
                    label: 'Add new access key',
                    value: 'NEW_KEY'
                },
                null,
                ...awsCredentialsList().map(
                    ({ access_key }) => ({ value: access_key })
                )
            ]
        );

        this.accessKey = ko.observable().extend({ 
            required: { message: 'Please choose an aws access key'}  
        });;
        this.accessKey.subscribe(
            accessKey => accessKey === 'NEW_KEY' && this.isAWSCredentialsModalVisible(true)
        );
        this.accessKey.subscribe(
            () => this.awsBucket(null)
        );

        this.awsCredentials = ko.pureComputed(
            () => awsCredentialsList().find(
                ({ access_key }) => access_key === this.accessKey()
            )
        );
        this.awsCredentials.subscribe(
            credentials => credentials && this.loadBucketsList()
        );

        this.awsBucketsOptions = ko.pureComputed(
            () => this.awsCredentials() && awsBucketList().map(
                bucketName => ({ value: bucketName })
            )
        );
        this.awsBucket = ko.observable().extend({ 
            required: { 
                params: this.accessKey,
                message: 'Please choose an aws bucket'
            }  
        });

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

        this.errors = ko.validation.group(this);

        loadAccountAwsCredentials();
    }

    loadBucketsList() {
        let { access_key, secret_key } = this.awsCredentials();
        loadAwsBucketList(access_key, secret_key);
    }

    onNewCredentials(canceled) {
        this.isAWSCredentialsModalVisible(false);
        canceled ? 
            this.accessKey(null) :
            this.accessKey();
    }

    cancel() {
        this.onClose();
    }

    save() {
        if (this.errors().length > 0) {
            this.errors.showAllMessages();
        } else {
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
}

export default {
    viewModel: CloudSyncModalViewModel,
    template: template
}   