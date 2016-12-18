import template from './add-cloud-resource-modal.html';
import Disposable from 'disposable';
import ko from 'knockout';
import { systemInfo, sessionInfo, cloudBucketList } from 'model';
import { loadCloudBucketList, createCloudResource } from 'actions';
import { deepFreeze } from 'utils/core-utils';

const addConnectionOption = deepFreeze({
    label: 'Add new connection',
    value: {}
});

const targetSubject = deepFreeze({
    AWS: 'Bucket',
    AZURE: 'Container',
    S3_COMPATIBLE: 'Bucket'
});

class AddCloudResourceModalViewModel extends Disposable {
    constructor({ onClose }) {
        super();

        this.onClose = onClose;

        const cloudConnections = ko.pureComputed(
            () => {
                const user = (systemInfo() ? systemInfo().accounts : []).find(
                    account => account.email === sessionInfo().user
                );

                return user.external_connections.connections;
            }
        );

        this.connectionOptions = ko.pureComputed(
            () => [
                addConnectionOption,
                null,
                ...cloudConnections().map(
                    connection => ({
                        label: connection.name || connection.access_key,
                        value: connection
                    })
                )
            ]
        );

        const _connection = ko.observable();

        _connection.debug();
        this.connection = ko.pureComputed({
            read: _connection,
            write: value => {
                if (value !== addConnectionOption.value) {
                    _connection(value);
                } else {
                    _connection(_connection() || null);
                    this.showAddCloudConnectionModal();
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

        this.targeBucketLabel = ko.pureComputed(
            () => {
                const { endpoint_type = 'AWS' } = this.connection() || {};
                return `Target ${targetSubject[endpoint_type]}`;
            }
        );

        this.targetBucketPlaceholder = ko.pureComputed(
            () => {
                const { endpoint_type = 'AWS' } = this.connection() || {};
                return `Choose ${targetSubject[endpoint_type]}...`;
            }
        );

        this.targetBucketsOptions = ko.pureComputed(
            () => this.connection() && cloudBucketList() && cloudBucketList().map(
                bucketName => ({ value: bucketName })
            )

        );

        this.targetBucket = ko.observable()
            .extend({
                required: {
                    onlyIf: this.connection,
                    message: () => {
                        const { endpoint_type = 'AWS' } = this.connection() || {};
                        return `Please select a ${
                            targetSubject[endpoint_type].toLowerCase()
                        } from the list`;
                    }
                }
            });

        const namesInUse = ko.pureComputed(
            () => systemInfo() && systemInfo().pools.map(
                pool => pool.name
            )
        );

        this.resourceName = ko.observableWithDefault(
            () => {
                const base = this.targetBucket();
                let i = 0;

                let name = base;
                while (namesInUse().includes(name)) {
                    name = `${base}-${++i}`;
                }

                return name;
            }
        )
            .extend({
                required: {
                    onlyIf: this.targetBucket,
                    message: 'Please select a name for the resource'
                },
                notIn: {
                    params: namesInUse,
                    message: 'This name is already in use by another resource'
                }
            });

        this.isAddCloudConnectionModalVisible = ko.observable(false);

        this.errors = ko.validation.group([
            this.connection,
            this.targetBucket,
            this.resourceName
        ]);
    }

    loadBucketsList() {
        loadCloudBucketList(this.connection().name);
    }

    showAddCloudConnectionModal() {
        this.isAddCloudConnectionModalVisible(true);
    }

    hideAddCloudConnectionModal() {
        this.isAddCloudConnectionModalVisible(false);
    }

    add() {
        if (this.errors().length > 0) {
            this.errors.showAllMessages();

        } else {
            createCloudResource(this.resourceName(), this.connection().name, this.targetBucket());
            this.onClose();
        }
    }

    cancel() {
        this.onClose();
    }
}

export default {
    viewModel: AddCloudResourceModalViewModel,
    template: template
};
