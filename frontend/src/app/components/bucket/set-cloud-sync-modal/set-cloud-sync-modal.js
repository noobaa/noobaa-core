import template from './set-cloud-sync-modal.html';
import ko from 'knockout';
import { S3Connections, S3BucketList } from 'model';
import { loadS3Connections, loadS3BucketList, setCloudSyncPolicy } from 'actions';

const [ MIN, HOUR, DAY ] = [ 1, 60, 60 * 24 ];
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
        label: 'Source to Target'
    },
    {
        value: 'AWS2NB',
        label: 'Target to Source'
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
                ...S3Connections().map(
                    connection => ({
                        label: connection.name || connection.access_key,
                        value: connection
                    })
                )
            ]
        );

        let connectionStorage = ko.observable();
        this.connection = ko.pureComputed({
            read: connectionStorage,
            write: val => {
                if (val !== addConnectionOption.value) {
                    connectionStorage(val);
                } else {
                    connectionStorage(connectionStorage() || null);
                    this.isAWSCredentialsModalVisible(true);
                }
            }
        })
            .extend({
                required: { message: 'Please select a connection from the list' }
            });

        this.connectionSub = this.connection.subscribe(
            value => {
                this.targetBucket(null);
                value && this.loadBucketsList();
            }
        );

        this.targetBucketsOptions = ko.pureComputed(
            () => {
                if (!this.connection() || !S3BucketList()) {
                    return [];
                }

                return S3BucketList().map(
                    bucketName => ({ value: bucketName })
                );
            }
        );

        this.targetBucket = ko.observable()
            .extend({
                required: {
                    onlyIf: this.connection,
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

        this.errors = ko.validation.group([
            this.connection,
            this.targetBucket
        ]);

        loadS3Connections();
    }

    loadBucketsList() {
        loadS3BucketList(this.connection().name);
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
                this.connection().name,
                this.targetBucket(),
                this.direction(),
                this.frequency() * this.frequencyUnit(),
                this.syncDeletions()
            );
            this.onClose();
        }
    }

    dispose() {
        this.connectionSub.dispose();
    }
}

export default {
    viewModel: CloudSyncModalViewModel,
    template: template
};
