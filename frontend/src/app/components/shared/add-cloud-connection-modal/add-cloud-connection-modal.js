import template from './add-cloud-connection-modal.html';
import Disposable from 'disposable';
import ko from 'knockout';
import { CloudConnections, isCloudConnectionValid } from 'model';
import { checkCloudConnection, addCloudConnection } from 'actions';
import { deepFreeze } from 'utils';

const endpointTypeMapping = deepFreeze({
    AWS: {
        label: 'AWS S3 Storage',
        identityLabel: 'Access Key',
        secretLabel: 'Secret Key',
        defaultEndpoint: 'https://s3.amazonaws.com'
    },
    AZURE: {
        label: 'Microsoft Azure Blob Storage',
        identityLabel: 'Account Name',
        secretLabel: 'Account Key',
        defaultEndpoint: 'https://blob.core.windows.net'
    },
    S3_COMPATIBLE: {
        label: 'S3 Compatible Storage',
        identityLabel: 'Access Key',
        secretLabel: 'Secret Key'
    }
});

class AddCloudConnectionModalViewModel extends Disposable {
    constructor({ onClose }) {
        super();

        isCloudConnectionValid(true);
        this.onClose = onClose;

        let existingNames = CloudConnections.map(
            ({ name }) => name
        );

        this.name = ko.observableWithDefault(
            () => {
                let highest = existingNames()
                    .map(
                        name => {
                            let match = name.match(/^Connection (\d+)$/);
                            return match ? parseInt(match[1]) : 0;
                        }
                    )
                    .reduce(
                        (a, b) => a > b ? a : b,
                        0
                    );

                return `Connection ${highest + 1}`;
            }
        )
        .extend({
            required: { message: 'Please enter valid connection name' },
            notIn: {
                params: { list: existingNames },
                message: 'Name already in use'
            }
        });

        this.endpointTypeOptions = Object.keys(endpointTypeMapping).map(
            type => {
                let value = endpointTypeMapping[type];
                return { label: value.label, value: type };
            }
        );

        this.endpointType = ko.observable('AWS');

        let endpointTypeInfo = ko.pureComputed(
            () => endpointTypeMapping[this.endpointType()]
        );

        this.endpoint = ko.observableWithDefault(
            () => endpointTypeInfo().defaultEndpoint
        )
            .extend({
                required: { message: 'Please enter valid URI endpoint' },
                isURI: true
            });

        this.identityLabel = ko.pureComputed(
            () => endpointTypeInfo().identityLabel
        );

        this.identity = ko.observable()
            .extend({
                required: { message: 'Please enter an aws access key' },
                notIn: {
                    params: {
                        list: CloudConnections.map(
                            ({ access_key }) => access_key
                        )
                    },
                    message: 'Access Key already defined'
                }
            });

        this.secretLabel = ko.pureComputed(
            () => endpointTypeInfo().secretLabel
        );

        this.secret = ko.observable()
            .extend({
                required: { message: 'Please enter an aws secret key'}
            });

        this.isValidConenction = isCloudConnectionValid
            .extend({
                equal: {
                    params: true,
                    message: 'Invalid endpoint or credentials'
                }
            });

        this.addToDisposeList(
            isCloudConnectionValid.subscribe(
                isValid => isValid && this.save()
            )
        );

        this.errors = ko.validation.group(this);
    }

    tryConnection() {
        if (this.errors().length > 0) {
            this.errors.showAllMessages();
        } else {
            checkCloudConnection(
                this.endpointType(),
                this.endpoint(),
                this.identity(),
                this.secret()
            );
        }
    }

    save() {
        addCloudConnection(
            this.name(),
            this.endpointType(),
            this.endpoint(),
            this.identity(),
            this.secret()
        );

        this.onClose(false);
    }

    cancel() {
        isCloudConnectionValid(false);
        this.onClose(true);
    }
}

export default {
    viewModel: AddCloudConnectionModalViewModel,
    template: template
};
