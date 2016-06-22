import template from './add-cloud-resource-modal.html';
import ko from 'knockout';
import { S3Connections, S3BucketList, systemInfo } from 'model';
import { loadS3Connections, loadS3BucketList, createCloudPool } from 'actions';

const addConnectionOption = Object.freeze({
    label: 'Add new connection',
    value: {}
});

class AddCloudResourceModalViewModel {
    constructor({ onClose }) {
        this.onClose = onClose;

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

        let _connection = ko.observable();
        this.connection = ko.pureComputed({
            read: _connection,
            write: value => {
                if (value !== addConnectionOption.value) {
                    _connection(value);
                } else {
                    _connection(_connection() || null);
                    this.showAddS3ConnectionModal();
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
            () => this.connection() && S3BucketList() &&  S3BucketList().map(
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

        this.isAddS3ConnectionModalVisible = ko.observable(false);

        this.errors = ko.validation.group([
            this.connection,
            this.targetBucket,
            this.resourceName
        ]);

        loadS3Connections();
    }

    loadBucketsList() {
        loadS3BucketList(this.connection().name);
    }

    showAddS3ConnectionModal() {
        this.isAddS3ConnectionModalVisible(true);
    }

    hideAddS3ConnectionModal() {
        this.isAddS3ConnectionModalVisible(false);
    }

    add() {
        if (this.errors().length > 0) {
            this.errors.showAllMessages();
        } else {
            createCloudPool(this.resourceName(), this.connection(), this.targetBucket());
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
