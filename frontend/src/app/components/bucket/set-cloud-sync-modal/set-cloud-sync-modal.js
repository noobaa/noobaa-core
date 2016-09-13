import template from './set-cloud-sync-modal.html';
import Disposable from 'disposable';
import ko from 'knockout';
import { CloudConnections, CloudBucketList } from 'model';
import { loadCloudConnections, loadCloudBucketList, setCloudSyncPolicy } from 'actions';

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
        value: 3,
        label: 'Bi-Direcitonal'
    },
    {
        value: 1,
        label: 'Source to Target'
    },
    {
        value: 2,
        label: 'Target to Source'
    }
]);

const addConnectionOption = Object.freeze({
    label: 'Add new connection',
    value: {}
});

class CloudSyncModalViewModel extends Disposable {
    constructor({ bucketName, onClose }) {
        super();

        this.onClose = onClose;
        this.bucketName = bucketName;

        this.connectionOptions = ko.pureComputed(
            () => [
                addConnectionOption,
                null,
                ...CloudConnections().map(
                    connection => ({
                        label: connection.name || connection.access_key,
                        value: connection
                    })
                )
            ]
        );

        let _connection = ko.observable();
        this.connection = ko.pureComputed({
            read: _connection,
            write: value => {
                if (value !== addConnectionOption.value) {
                    _connection(value);
                } else {
                    _connection(_connection() || null);
                    this.isAddCloudConnectionModalVisible(true);
                }
            }
        })
            .extend({
                required: { message: 'Please select a connection from the list' }
            });

        this.addToDisposeList(
            this.connection.subscribe(
                value => {
                    this.targetBucket(null);
                    value && this.loadBucketsList();
                }
            )
        );

        this.targetBucketsOptions = ko.pureComputed(
            () => {
                if (!this.connection() || !CloudBucketList()) {
                    return;
                }

                return CloudBucketList().map(
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

        this.direction = ko.observable(3);
        this.directionOptions = directionOptions;

        this.frequency = ko.observable(1);
        this.frequencyUnit = ko.observable(HOUR);
        this.frequencyUnitOptions = frequencyUnitOptions;

        let _syncDeletions = ko.observable(true);
        this.syncDeletions = ko.pureComputed({
            read: () => this.direction() === 3 ? true : _syncDeletions(),
            write: _syncDeletions
        });

        this.isAddCloudConnectionModalVisible = ko.observable(false);

        this.errors = ko.validation.group([
            this.connection,
            this.targetBucket
        ]);

        loadCloudConnections();
    }

    loadBucketsList() {
        loadCloudBucketList(this.connection().name);
    }

    showAddCloudConnectionModal() {
        this.connection.isModified(false);
        this.isAddCloudConnectionModalVisible(true);
    }

    hideAddCloudConnectionModal() {
        this.isAddCloudConnectionModalVisible(false);
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
}

export default {
    viewModel: CloudSyncModalViewModel,
    template: template
};
