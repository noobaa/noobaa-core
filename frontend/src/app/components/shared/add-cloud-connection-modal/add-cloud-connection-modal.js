import template from './add-cloud-connection-modal.html';
import BaseViewModel from 'base-view-model';
import ko from 'knockout';
import { systemInfo, sessionInfo, isCloudConnectionValid } from 'model';
import { checkCloudConnection, addCloudConnection } from 'actions';
import { deepFreeze } from 'utils/core-utils';

const serviceMapping = deepFreeze({
    AWS: {
        optionLabel: 'AWS S3',
        identity: {
            label: 'Access Key',
            placeholder: 'Enter Key',
            requiredMessage: 'Please enter an AWS access key',
            duplicateMessage: 'Access key already used in another AWS connection'
        },
        secret: {
            label: 'Secret Key',
            placeholder: 'Enter Secret',
            requiredMessage: 'Please enter an AWS secret key'
        },
        defaultEndpoint: 'https://s3.amazonaws.com'
    },
    AZURE: {
        optionLabel: 'Microsoft Azure',
        identity: {
            label: 'Account Name',
            placeholder: 'Enter Name',
            requiredMessage: 'Please enter an Azure acount name',
            duplicateMessage: 'Account name already used in another azure connection'
        },
        secret: {
            label: 'Account Key',
            placeholder: 'Enter Key',
            requiredMessage: 'Please enter an Azure account key'
        },
        defaultEndpoint: 'https://blob.core.windows.net'
    },
    S3_COMPATIBLE: {
        optionLabel: 'Generic S3 Compatible Service',
        identity: {
            label: 'Access Key',
            placeholder: 'Enter Key',
            requiredMessage: 'Please enter an access key',
            duplicateMessage: 'Access key already used in another S3 compatible connection'
        },
        secret: {
            label: 'Secret Key',
            placeholder: 'Enter Secret',
            requiredMessage: 'Please enter a secret key'
        }
    }
});

class AddCloudConnectionModalViewModel extends BaseViewModel {
    constructor({
        onClose,
        allowedServices =  Object.keys(serviceMapping)
    }) {
        super();

        isCloudConnectionValid(true);
        this.onClose = onClose;

        const cloudConnections = ko.pureComputed(
            () => {
                const user = (systemInfo() ? systemInfo().accounts : []).find(
                    account => account.email === sessionInfo().user
                );

                return user.external_connections.connections;
            }
        );

        let existingNames = ko.pureComputed(
            () => cloudConnections().map(
                ({ name }) => name
            )
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

        this.serviceOptions = allowedServices.map(
            type => ({
                label: serviceMapping[type].optionLabel,
                value: type
            })
        );

        this.service = ko.observable('AWS');

        let serviceInfo = ko.pureComputed(
            () => serviceMapping[this.service()]
        );

        this.endpoint = ko.observableWithDefault(
            () => serviceInfo().defaultEndpoint
        )
            .extend({
                required: { message: 'Please enter valid URI endpoint' },
                isURI: true
            });

        this.identityLabel = ko.pureComputed(
            () => serviceInfo().identity.label
        );

        this.identityPlaceholder = ko.pureComputed(
            () => serviceInfo().identity.placeholder
        );

        let identityBlackList = ko.pureComputed(
            () => cloudConnections().map(
                ({ endpoint_type, access_key }) => `${endpoint_type}:${access_key}`
            )
        );

        this.identity = ko.observable()
            .extend({
                required: {
                    message: () => serviceInfo().identity.requiredMessage
                },

                validation: {
                    validator: val => !identityBlackList().includes(
                        `${this.service()}:${val}`
                    ),
                    message: () => serviceInfo().identity.duplicateMessage
                }
            });

        this.secretLabel = ko.pureComputed(
            () => serviceInfo().secret.label
        );

        this.secretPlaceholder = ko.pureComputed(
            () => serviceInfo().secret.placeholder
        );

        this.secret = ko.observable()
            .extend({
                required: {
                    message: () => serviceInfo().secret.requiredMessage
                }
            });

        this.isValidConnection = isCloudConnectionValid
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

        // Dont use 'this' as argument because we want to exclude this.isValidConnection
        this.errors = ko.validation.group([
            this.endpoint,
            this.identity,
            this.secret
        ]);
    }

    tryConnection() {
        if (this.errors().length > 0) {
            this.errors.showAllMessages();

        } else {
            checkCloudConnection(
                this.service(),
                this.endpoint(),
                this.identity(),
                this.secret()
            );
        }
    }

    save() {
        addCloudConnection(
            this.name(),
            this.service(),
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
