/* Copyright (C) 2016 NooBaa */

import template from './edit-cloud-connection-modal.html';
import awsFieldsTemplate from './aws-fields.html';
import ibmFieldsTemplate from './ibm-fields.html';
import azureFieldsTemplate from './azure-fields.html';
import s3v2CompatibleFieldsTemplate from './s3-v2-compatible-fields.html';
import s3v4CompatibleFieldsTemplate from './s3-v4-compatible-fields.html';
import googleCloudTemplate from './google-cloud-fields.html';
import ConnectableViewModel from 'components/connectable';
import ko from 'knockout';
import { deepFreeze, isUndefined, pick } from 'utils/core-utils';
import { getCloudServiceMeta } from 'utils/cloud-utils';
import { readFileAsText } from 'utils/browser-utils';
import { getFieldError } from 'utils/form-utils';
import { sleep, all } from 'utils/promise-utils';
import { api } from 'services';
import {
    updateForm,
    updateExternalConnection,
    openCloudConnectionUpdateWarningModal,
    closeModal
} from 'action-creators';

const gcEndpoint = getCloudServiceMeta('GOOGLE').defaultEndpoint;
const gcValidateFailureMessage = 'Try to regenerate and upload a new file';

const templates = deepFreeze({
    AWS: awsFieldsTemplate,
    AZURE: azureFieldsTemplate,
    S3_V2_COMPATIBLE: s3v2CompatibleFieldsTemplate,
    S3_V4_COMPATIBLE: s3v4CompatibleFieldsTemplate,
    GOOGLE: googleCloudTemplate,
    IBM_COS: ibmFieldsTemplate
});

const s3LikeConnKeyMappings = deepFreeze({
    AWS: {
        endpoint: 'awsEndpoint',
        accessKey: 'awsAccessKey',
        secretKey: 'awsSecretKey'
    },
    S3_V2_COMPATIBLE: {
        endpoint: 's3v2Endpoint',
        accessKey: 's3v2AccessKey',
        secretKey: 's3v2SecretKey'
    },
    S3_V4_COMPATIBLE: {
        endpoint: 's3v4Endpoint',
        accessKey: 's3v4AccessKey',
        secretKey: 's3v4SecretKey'
    },
    FLASHBLADE: {
        endpoint: 'fbEndpoint',
        accessKey: 'fbAccessKey',
        secretKey: 'fbSecretKey'
    },
    IBM_COS: {
        endpoint: 'ibmEndpoint',
        accessKey: 'ibmAccessKey',
        secretKey: 'ibmSecretKey'
    }
});

function _getFormFields(connection) {
    const commonFields = {
        connectionName: connection.name,
        service: connection.service
    };

    switch (connection.service) {
        case 'AWS': {
            return {
                ...commonFields,
                awsEndpoint: connection.endpoint,
                awsAccessKey: connection.identity,
                awsSecretKey: ''
            };
        }
        case 'AZURE': {
            return {
                ...commonFields,
                azureEndpoint: connection.endpoint,
                azureAccountName: connection.identity,
                azureAccountKey: ''
            };
        }
        case 'S3_V2_COMPATIBLE': {
            return {
                ...commonFields,
                s3v2Endpoint: connection.endpoint,
                s3v2AccessKey: connection.identity,
                s3v2SecretKey: ''
            };
        }
        case 'S3_V4_COMPATIBLE': {
            return {
                ...commonFields,
                s3v4Endpoint: connection.endpoint,
                s3v4AccessKey: connection.identity,
                s3v4SecretKey: ''
            };
        }
        case 'GOOGLE': {
            return {
                ...commonFields,
                gcKeysFileName: '',
                gcKeysJson: ''
            };
        }
        case 'IBM_COS': {
            return {
                ...commonFields,
                ibmEndpoint: connection.endpoint,
                ibmAccessKey: connection.identity,
                ibmSecretKey: ''
            };
        }
    }
}

function _onS3LikeValidate(keys, values, existingConnections) {
    const errors = {};

    if (!values[keys.accessKey]) {
        errors[keys.accessKey] = 'Please enter an access key';

    } else {
        const alreadyExists = existingConnections
            .some(connection =>
                connection.endpoint === values[keys.endpoint] &&
                connection.identity === values[keys.accessKey]
            );

        if (alreadyExists) {
            errors[keys.accessKey] = 'A similar connection already exists';
        }
    }

    if (!values[keys.secretKey]) {
        errors[keys.secretKey] = 'Please enter a secret key';
    }

    return errors;
}

async function _onS3LikeValidateAsync(keys, values, service, displayName, authMethod) {
    const errors = {};
    const { status, error } = await api.account.check_external_connection({
        endpoint_type: service,
        endpoint: values[keys.endpoint],
        identity: values[keys.accessKey],
        secret: values[keys.secretKey],
        auth_method: authMethod
    });

    switch (status) {
        case 'TIMEOUT': {
            errors.global = `${displayName} connection timed out`;
            break;
        }
        case 'INVALID_ENDPOINT': {
            errors.global = `Please enter a valid ${displayName} endpoint`;
            break;
        }
        case 'INVALID_CREDENTIALS': {
            errors[keys.accessKey] = errors[keys.secretKey] = 'Credentials do not match';
            break;
        }
        case 'NOT_SUPPORTED': {
            errors[keys.accessKey] = 'Account type is not supported';
            break;
        }
        case 'TIME_SKEW': {
            errors[keys.accessKey] = 'Time difference with the server is too large';
            break;
        }
        case 'UNKNOWN_FAILURE': {
            // Using empty message to mark the fields as invalid.
            errors[keys.endpoint] = errors[keys.accessKey] = errors[keys.secretKey] = '';
            errors.global = error.message;
            break;
        }
    }

    return errors;
}

class EditCloudConnectionModalViewModel extends ConnectableViewModel {
    formName = this.constructor.name;
    accountName = '';
    serviceOptions = ko.observableArray()
    subTemplate = ko.observable();
    existingConnections = null;
    asyncTriggers = [
        'service',
        'awsEndpoint',
        'awsAccessKey',
        'awsSecretKey',
        'azureEndpoint',
        'azureAccountName',
        'azureAccountKey',
        's3v2Endpoint',
        's3v2AccessKey',
        's3v2SecretKey',
        's3v4Endpoint',
        's3v4AccessKey',
        's3v4SecretKey',
        'gcKeysFileName',
        'gcKeysJson',
        'ibmEndpoint',
        'ibmAccessKey',
        'ibmSecretKey'
    ];
    formFields = ko.observable()
    globalError = ko.observable();
    isConnectionInUse = false;

    selectState(state, params) {
        const { accounts, forms } = state;
        const connections = accounts &&
            accounts[params.accountName] &&
            accounts[params.accountName].externalConnections;

        return [
            params.accountName,
            params.connectionName,
            connections,
            forms[this.formName]
        ];
    }

    mapStateToProps(accountName, connectionName, connections, form) {
        if (!connections) {
            return;
        }

        const connection = connections.find(conn => conn.name === connectionName);
        const otherConnections = connections.filter(conn => conn !== connection);
        const { service } = connection;
        const serviceMeta = getCloudServiceMeta(service);

        ko.assignToProps(this, {
            accountName,
            existingConnections: otherConnections,
            serviceOptions: [{
                value: serviceMeta.value,
                label: serviceMeta.displayName,
                icon: serviceMeta.icon,
                selectedIcon: serviceMeta.selectedIcon,
                remark: serviceMeta.defaultEndpoint || 'No default endpoint'
            }],
            subTemplate: templates[service],
            formFields: !form ? _getFormFields(connection) : undefined,
            globalError: form ? getFieldError(form, 'global') : '',
            isConnectionInUse: connection.usage.length > 0
        });
    }

    onValidate(values, existingConnections) {
        const { service } = values;
        const serviceValidateSync =
            (service === 'AWS' && this.awsOnValidate) ||
            (service === 'AZURE' && this.azureOnValidate) ||
            (service === 'S3_V2_COMPATIBLE' && this.s3v2OnValidate) ||
            (service === 'S3_V4_COMPATIBLE' && this.s3v4OnValidate) ||
            (service === 'GOOGLE' && this.gcOnValidate) ||
            (service === 'IBM_COS' && this.ibmOnValidate) ||
            (() => {});

        return serviceValidateSync(values, existingConnections);
    }

    async onValidateAsync(values) {
        const { service } = values;
        const serviceValidateAsync =
            (service === 'AWS' && this.awsOnValidateAsync) ||
            (service === 'AZURE' && this.azureOnValidateAsync) ||
            (service === 'S3_V2_COMPATIBLE' && this.s3v2OnValidateAsync) ||
            (service === 'S3_V4_COMPATIBLE' && this.s3v4OnValidateAsync) ||
            (service === 'GOOGLE' && this.gcOnValidateAsync) ||
            (service === 'IBM_COS' && this.ibmOnValidateAsync) ||
            (() => {});

        return await serviceValidateAsync(values);
    }

    onSubmit(values) {
        const { connectionName, service } = values;
        const fields =
            (service === 'AWS' && ['awsAccessKey', 'awsSecretKey']) ||
            (service === 'AZURE' && ['azureAccountKey']) ||
            (service === 'S3_V2_COMPATIBLE' && ['s3v2AccessKey', 's3v2SecretKey']) ||
            (service === 'S3_V4_COMPATIBLE' && ['s3v4AccessKey', 's3v4SecretKey']) ||
            (service === 'IBM_COS' && ['ibmAccessKey', 'ibmSecretKey']) ||
            (service === 'GOOGLE' && ['gcKeysJson']);

        const params = pick(values, fields);
        if (service === 'GOOGLE') params.gcEndpoint = gcEndpoint;

        const updateAction = updateExternalConnection(connectionName, service, params);
        if (this.isConnectionInUse) {
            this.dispatch(
                openCloudConnectionUpdateWarningModal(
                    this.accountName,
                    connectionName,
                    updateAction
                )
            );

        } else {
            this.dispatch(
                closeModal(),
                updateAction
            );
        }

    }

    onCancel() {
        this.dispatch(closeModal());
    }

    // --------------------------------------
    // Azure related methods:
    // --------------------------------------
    azureOnValidate(values) {
        const { azureAccountKey } = values;
        const errors = {};

        if (!azureAccountKey) {
            errors.azureAccountKey = 'Please enter an Azure account key';
        }

        return errors;
    }

    async azureOnValidateAsync(values) {
        const errors = {};
        const { azureEndpoint, azureAccountName, azureAccountKey } = values;
        const { status, error } = await api.account.check_external_connection({
            endpoint_type: 'AZURE',
            endpoint: azureEndpoint,
            identity: azureAccountName,
            secret: azureAccountKey
        });

        switch (status) {
            case 'TIMEOUT': {
                errors.global = 'Azure connection timed out';
                break;
            }
            case 'INVALID_ENDPOINT': {
                errors.global = 'Please enter a valid Azure endpoint';
                break;
            }
            case 'INVALID_CREDENTIALS': {
                errors.azureAccountKey = 'Credentials do not match';
                break;
            }
            case 'NOT_SUPPORTED': {
                errors.global = 'Account type is not supported';
                break;
            }
            case 'TIME_SKEW': {
                errors.global = 'Time difference with the server is too large';
                break;
            }
            case 'UNKNOWN_FAILURE': {
                // Using empty message to mark the fields as invalid.
                errors.global = error.message;
                break;
            }
        }

        return errors;
    }

    // --------------------------------------
    // AWS related methods:
    // --------------------------------------
    awsOnValidate(values, existingConnections) {
        const awsConnections = existingConnections
            .filter(connection => connection.service === 'AWS');

        return _onS3LikeValidate(
            s3LikeConnKeyMappings['AWS'],
            values,
            awsConnections
        );
    }

    async awsOnValidateAsync(values) {
        return _onS3LikeValidateAsync(
            s3LikeConnKeyMappings['AWS'],
            values,
            'AWS',
            'AWS',
            'AWS_V4'
        );
    }

    // --------------------------------------
    // AWS related methods:
    // --------------------------------------
    ibmOnValidate(values, existingConnections) {
        const ibmConnections = existingConnections
            .filter(connection => connection.service === 'IBM_COS');

        return _onS3LikeValidate(
            s3LikeConnKeyMappings['IBM_COS'],
            values,
            ibmConnections
        );
    }

    async ibmOnValidateAsync(values) {
        return _onS3LikeValidateAsync(
            s3LikeConnKeyMappings['IBM_COS'],
            values,
            'IBM_COS',
            'IBM COS',
            'AWS_V2'
        );
    }

    // --------------------------------------
    // S3 Compatible (v2) methods:
    // --------------------------------------
    s3v2OnValidate(values, existingConnections) {
        const s3CompatibleConnections = existingConnections.filter(connection =>
            connection.service === 'S3_V2_COMPATIBLE' ||
            connection.service === 'S3_V4_COMPATIBLE'
        );

        return _onS3LikeValidate(
            s3LikeConnKeyMappings['S3_V2_COMPATIBLE'],
            values,
            s3CompatibleConnections
        );
    }

    async s3v2OnValidateAsync(values) {
        return _onS3LikeValidateAsync(
            s3LikeConnKeyMappings['S3_V2_COMPATIBLE'],
            values,
            'S3_COMPATIBLE',
            'S3 compatible',
            'AWS_V2'
        );
    }

    // --------------------------------------
    // S3 Compatible (v4) methods:
    // --------------------------------------
    s3v4OnValidate(values, existingConnections) {
        const s3CompatibleConnections = existingConnections
            .filter(connection =>
                connection.service === 'S3_V2_COMPATIBLE' ||
                connection.service === 'S3_V4_COMPATIBLE'
            );

        return _onS3LikeValidate(
            s3LikeConnKeyMappings['S3_V4_COMPATIBLE'],
            values,
            s3CompatibleConnections
        );
    }

    async s3v4OnValidateAsync(values) {
        return _onS3LikeValidateAsync(
            s3LikeConnKeyMappings['S3_V4_COMPATIBLE'],
            values,
            'S3_COMPATIBLE',
            'S3 compatible',
            'AWS_V4'
        );
    }

    // --------------------------------------
    // Google Cloud related methods:
    // --------------------------------------
    gcOnDropKeysFile(vm, evt) {
        const [file] = evt.dataTransfer.files;
        return this._gcOnKeysFile(file);
    }

    async gcOnSelectKeysFile(vm, evt) {
        const [file] = evt.target.files;
        return await this._gcOnKeysFile(file);
    }

    gcOnValidate(values, existingConnections) {
        const errors = {};
        const { gcKeysJson } = values;

        if (!gcKeysJson) {
            errors.gcKeysJson = 'Please upload a JSON keys file';
        } else {
            try {
                const { private_key_id: id } = JSON.parse(gcKeysJson);
                if (isUndefined(id)) {
                    errors.gcKeysJson = gcValidateFailureMessage;

                } else {
                    const alreadyExists = existingConnections
                        .some(connection =>
                            connection.service === 'GOOGLE' &&
                            connection.identity === id
                        );

                    if (alreadyExists) {
                        errors.gcKeysJson = 'A similar connection already exists';
                    }
                }
            } catch (_) {
                errors.gcKeysJson = gcValidateFailureMessage;
            }
        }

        return errors;
    }

    async gcOnValidateAsync(values) {
        const errors = {};
        const { gcKeysJson } = values;
        const { private_key_id: id } = JSON.parse(gcKeysJson);
        const [{ status, error }] = await all(
            api.account.check_external_connection({
                endpoint_type: 'GOOGLE',
                endpoint: gcEndpoint,
                identity: id,
                secret: gcKeysJson
            }),
            sleep(1000)
        );

        switch (status) {
            case 'INVALID_CREDENTIALS': {
                errors.gcKeysJson = gcValidateFailureMessage;
                break;
            }
            case 'UNKNOWN_FAILURE': {
                // Using empty message to mark the fields as invalid.
                errors.gcPrivateKeyId = errors.gcKeysJson = '';
                errors.global = error.message;
                break;
            }
        }

        return errors;
    }

    async _gcOnKeysFile(file) {
        const gcKeysFileName = file.name;
        const gcKeysJson = await readFileAsText(file);
        this.dispatch(updateForm(this.formName, { gcKeysFileName, gcKeysJson }));
    }
}

export default {
    viewModel: EditCloudConnectionModalViewModel,
    template: template
};
