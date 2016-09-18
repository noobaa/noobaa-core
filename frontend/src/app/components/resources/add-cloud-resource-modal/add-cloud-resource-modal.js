import template from './add-cloud-resource-modal.html';
import Disposable from 'disposable';
import ko from 'knockout';
import { CloudConnections, CloudBucketList, systemInfo } from 'model';
import { loadCloudConnections, loadCloudBucketList, createCloudResource } from 'actions';

const addConnectionOption = Object.freeze({
    label: 'Add new connection',
    value: {}
});

class AddCloudResourceModalViewModel extends Disposable {
    constructor({ onClose }) {
        super();

        this.onClose = onClose;

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

        this.targetBucketsOptions = ko.pureComputed(
            () => this.connection() && CloudBucketList() && CloudBucketList().map(
                bucketName => ({ value: bucketName })
            )

        );
        this.targetBucket = ko.observable()
            .extend({
                required: {
                    onlyIf: this.connection,
                    message: 'Please select a bucket from the list'
                }
            });

        let namesInUse = ko.pureComputed(
            () => systemInfo() && systemInfo().pools.map(
                pool => pool.name
            )
        );

        this.resourceName = ko.observableWithDefault(
            () => {
                let base = this.targetBucket();
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

        this.shake = ko.observable(false);

        loadCloudConnections();
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
            this.shake(true);

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
