import template from './set-cloud-sync-modal.html';
import ko from 'knockout';
import { awsCredentialsList, awsBucketList } from 'model';
import { loadAccountAwsCredentials, loadAwsBucketList, setCloudSyncPolicy } from 'actions';

const [MIN, HOUR, DAY] = [1, 60, 60 * 24];
const frequencyUnitOptions = Object.freeze([
    {
        value: MIN,
        label: 'Minutes'
    }, 
    {
        value: HOUR,
        label: 'Hours'
    }, 
    {
        value: DAY,
        label: 'Days'
    }
]);

const directionOptions = Object.freeze([
    {
        value: 'BI',
        label: 'Bi-Direcitonal'
    },
    {
        value: 'NB2AWS',
        label: 'NooBaa to AWS'
    },
    {
        value: 'AWS2NB',
        label: 'AWS to NooBaa'
    }
]);

const addConnectionOption = Object.freeze({
    label: 'Add new connection',
    value: {}
});

class CloudSyncModalViewModel {
    constructor({ bucketName, onClose }) {
        this.onClose = onClose;
        this.bucketName = bucketName;

        this.connectionOptions = ko.pureComputed(
            () => [
                addConnectionOption,
                null,
                ...awsCredentialsList().map(
                    connection => ({ 
                        label: connection.name || connection.access_key, 
                        value: connection
                     })
                )
            ]
        );

        let connectionStorage = ko.observable()
        this.connection = ko.pureComputed({
            read: connectionStorage,
            write: val => {
                if (val !== addConnectionOption.value) {
                    connectionStorage(val);
                } else {
                    connectionStorage(connectionStorage() || null)
                    this.isAWSCredentialsModalVisible(true);
                }
            }
        })
        .extend({
            required: { message: 'Please select a connection from the list' }
        });

        this.connection.subscribe(
            () => this.targetBucket(null)
        );

        this.connection.subscribe(
            value => value && this.loadBucketsList()
        );

        this.targetBucketsOptions = ko.pureComputed(
            () => this.connection() && awsBucketList() && awsBucketList().map(
                bucketName => ({ value: bucketName })
            )
        );

        this.targetBucket = ko.observable().extend({
            required: {
                params: this.connection,
                message: 'Please select a bucket from the list'
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
        let { access_key, secret_key, endpoint } = this.connection();
        loadAwsBucketList(access_key, secret_key, endpoint);
    }

    onNewCredentials(canceled) {
        this.isAWSCredentialsModalVisible(false);
        !canceled && this.connection();
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
                this.targetBucket(),
                this.connection(),
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
