/* Copyright (C) 2016 NooBaa */

import template from './add-cloud-connection-modal.html';
import awsFieldsTemplate from './aws-fields.html';
import azureFieldsTemplate from './azure-fields.html';
import s3v2CompatibleFieldsTemplate from './s3-v2-compatible-fields.html';
import s3v4CompatibleFieldsTemplate from './s3-v4-compatible-fields.html';
import netStorageTemplate from './net-storage-fields.html';
import googleCloudTemplate from './google-cloud-fields.html';
import flashbladeFieldsTemplate from './flashblade-fields.html';
import ConnectableViewModel from 'components/connectable';
import ko from 'knockout';
import { deepFreeze, pick, isUndefined } from 'utils/core-utils';
import { getFieldValue, getFieldError } from 'utils/form-utils';
import { isUri, readFileAsText } from 'utils/browser-utils';
import { all, sleep } from 'utils/promise-utils';
import { cloudServices, getCloudServiceMeta } from 'utils/cloud-utils';
import { addExternalConnection, updateForm, untouchForm, closeModal } from 'action-creators';
import { api } from 'services';

const nameRegExp = /^Connection (\d+)$/;
const defaultService = 'AWS';
const gcEndpoint = getCloudServiceMeta('GOOGLE').defaultEndpoint;
const gcValidateFailureMessage = 'Try to regenerate and upload a new file';

const serviceOptions = cloudServices
    .map(service => ({
        value: service.value,
        label: service.displayName,
        icon: service.icon,
        selectedIcon: service.selectedIcon,
        remark: service.defaultEndpoint || 'No default endpoint'
    }));

const templates = deepFreeze({
    AWS: awsFieldsTemplate,
    AZURE: azureFieldsTemplate,
    S3_V2_COMPATIBLE: s3v2CompatibleFieldsTemplate,
    S3_V4_COMPATIBLE: s3v4CompatibleFieldsTemplate,
    NET_STORAGE: netStorageTemplate,
    GOOGLE: googleCloudTemplate,
    FLASHBLADE: flashbladeFieldsTemplate
});

const asyncTriggers = deepFreeze([
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
    'nsHostname',
    'nsStorageGroup',
    'nsKeyName',
    'nsCPCode',
    'nsAuthKey',
    'gcKeysFileName',
    'gcKeysJson',
    'fbEndpoint',
    'fbAccessKey',
    'fbSecretKey'
]);

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
    }
});

function _suggestConnectionName(existing) {
    const suffix = existing
        .map(({ name }) => {
            const match = name.match(nameRegExp);
            return match ? parseInt(match[1]) : 0;
        })
        .reduce(
            // For some reason sending Math.max to reduce reutrns NaN for any value.
            // Using an an arrow function to bypass the problem.
            (max, val) => Math.max(max, val),
            0
        );

    return `Connection ${suffix + 1}`;
}

function _getEmptyObj() {
    return {};
}

function _onS3LikeValidate(
    keys,
    values,
    existingConnections,
    displayName
) {
    const errors = {};

    if (!isUri(values[keys.endpoint])) {
        errors[keys.endpoint] = `Please enter valid ${displayName} endpoint URI`;
    }

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

async function _onS3LikeValidateAsync(
    keys,
    values,
    service,
    displayName,
    authMethod
) {
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
            errors[keys.endpoint] = `${displayName} connection timed out`;
            break;
        }
        case 'INVALID_ENDPOINT': {
            errors[keys.endpoint] = `Please enter a valid ${displayName} endpoint`;
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

class AddCloudConnectionModalViewModel extends ConnectableViewModel  {
    formName = this.constructor.name;
    fields = ko.observable();
    asyncTriggers = asyncTriggers;
    allowedServices = null;
    service = '';
    serviceOptions = null;
    existingConnections = null;
    subTemplate = ko.observable();
    isFormInitialized = ko.observable();
    globalError = ko.observable();

    selectState(state, params) {
        return [
            params.allowedServices,
            state.accounts,
            state.session && state.session.user,
            state.forms[this.formName]
        ];
    }

    mapStateToProps(allowedServices, accounts, user, form) {
        if (!accounts || !user) {
            return;
        }

        const allowedServiceOptions = allowedServices ?
            serviceOptions.filter(opt => allowedServices.includes(opt.value)) :
            serviceOptions;

        const globalError  = form ? getFieldError(form, 'global') : '';
        const existingConnections = accounts[user].externalConnections;
        const service = form ? getFieldValue(form, 'service') : defaultService;
        const serviceChanged = this.service !== service;


        ko.assignToProps(this, {
            serviceOptions: allowedServiceOptions,
            globalError,
            existingConnections,
            service,
            subTemplate: templates[service],
            fields: !form ? {
                // Common fields
                connectionName: _suggestConnectionName(existingConnections),
                service: service,

                // AWS fields.
                awsEndpoint: 'https://s3.amazonaws.com',
                awsAccessKey: '',
                awsSecretKey: '',

                // Azure fields.
                azureEndpoint: 'https://blob.core.windows.net',
                azureAccountName: '',
                azureAccountKey: '',

                // S3 V2 compatible fileds.
                s3v2Endpoint: '',
                s3v2AccessKey: '',
                s3v2SecretKey: '',

                // S3 V4 compatible fileds.
                s3v4Endpoint: '',
                s3v4AccessKey: '',
                s3v4SecretKey: '',

                // Net Storage fileds.
                nsHostname: 'nsu.akamaihd.net',
                nsStorageGroup: '',
                nsKeyName: '',
                nsCPCode: '',
                nsAuthKey: '',

                // Google Cloud field.
                gcKeysFileName: '',
                gcKeysJson: '',

                // Pure FlashBlade fields.
                fbEndpoint: '',
                fbAccessKey: '',
                fbSecretKey: ''
            } : undefined
        });

        if (serviceChanged) {
            // Clear the touch state of the form whenever the
            // service changes.
            this.dispatch(untouchForm(this.formName));
        }
    }

    onValidate(values, existingConnections) {
        const { connectionName, service } = values;
        const errors = {};

        if (!connectionName) {
            errors.connectionName = 'Please enter valid connection name';
        }

        if (existingConnections
            .map(connection => connection.name)
            .includes(connectionName)
        ) {
            errors.connectionName = 'Name already in use';
        }

        const serviceValidate =
            (service === 'AWS' && this.awsOnValidate) ||
            (service === 'AZURE' && this.azureOnValidate) ||
            (service === 'S3_V2_COMPATIBLE' && this.s3v2OnValidate) ||
            (service === 'S3_V4_COMPATIBLE' && this.s3v4OnValidate) ||
            (service === 'NET_STORAGE' && this.nsOnValidate) ||
            (service === 'GOOGLE' && this.gcOnValidate) ||
            (service === 'FLASHBLADE' && this.flashBladeOnValidate) ||
            _getEmptyObj;

        return Object.assign(
            errors,
            serviceValidate(values, existingConnections)
        );
    }

    async onValidateAsync(values) {
        const { service } = values;
        const serviceValidateAsync =
            (service === 'AWS' && this.awsOnValidateAsync) ||
            (service === 'AZURE' && this.azureOnValidateAsync) ||
            (service === 'S3_V2_COMPATIBLE' && this.s3v2OnValidateAsync) ||
            (service === 'S3_V4_COMPATIBLE' && this.s3v4OnValidateAsync) ||
            (service === 'NET_STORAGE' && this.nsOnValidateAsync) ||
            (service === 'GOOGLE' && this.gcOnValidateAsync) ||
            (service === 'FLASHBLADE' && this.flashBladeOnValidateAsync) ||
            _getEmptyObj;


        return await serviceValidateAsync(values);
    }

    onSubmit(values) {
        const { connectionName, service } = values;
        const fields =
            (service === 'AWS' && Object.values(s3LikeConnKeyMappings['AWS'])) ||
            (service === 'AZURE' && ['azureEndpoint', 'azureAccountName', 'azureAccountKey']) ||
            (service === 'S3_V2_COMPATIBLE' && Object.values(s3LikeConnKeyMappings['S3_V2_COMPATIBLE'])) ||
            (service === 'S3_V4_COMPATIBLE' && Object.values(s3LikeConnKeyMappings['S3_V4_COMPATIBLE'])) ||
            (service === 'NET_STORAGE' && ['nsHostname', 'nsStorageGroup', 'nsKeyName', 'nsCPCode', 'nsAuthKey']) ||
            (service === 'GOOGLE' && ['gcKeysJson']) ||
            (service === 'FLASHBLADE' && Object.values(s3LikeConnKeyMappings['FLASHBLADE']));

        const params = pick(values, fields);
        if (service === 'GOOGLE') params.gcEndpoint = gcEndpoint;

        this.dispatch(
            closeModal,
            addExternalConnection(connectionName, service, params)
        );
    }

    onCancel() {
        this.dispatch(closeModal());
    }

    // --------------------------------------
    // Azure related methods:
    // --------------------------------------
    azureOnValidate(values, existingConnections) {
        const { azureEndpoint, azureAccountName, azureAccountKey } = values;
        const errors = {};

        if (!isUri(azureEndpoint)) {
            errors.azureEndpoint = 'Please enter valid Azure endpoint URI';
        }

        if (!azureAccountName) {
            errors.azureAccountName = 'Please enter an Azure acount name';

        } else {
            const alreadyExists = existingConnections
                .some(connection =>
                    connection.service === 'AZURE' &&
                    connection.endpoint === azureEndpoint &&
                    connection.identity === azureAccountName
                );

            if (alreadyExists) {
                errors.azureAccountName = 'A similar connection already exists';
            }
        }

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
                errors.azureEndpoint = 'Azure connection timed out';
                break;
            }
            case 'INVALID_ENDPOINT': {
                errors.azureEndpoint = 'Please enter a valid Azure endpoint';
                break;
            }
            case 'INVALID_CREDENTIALS': {
                errors.azureAccountName = errors.azureAccountKey = 'Credentials do not match';
                break;
            }
            case 'NOT_SUPPORTED': {
                errors.azureAccountName = 'Account type is not supported';
                break;
            }
            case 'TIME_SKEW': {
                errors.azureAccountName = 'Time difference with the server is too large';
                break;
            }
            case 'UNKNOWN_FAILURE': {
                // Using empty message to mark the fields as invalid.
                errors.azureEndpoint = errors.azureAccountName = errors.azureAccountKey = '';
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
            awsConnections,
            'AWS'
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
            s3CompatibleConnections,
            'S3 compatible'
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
            s3CompatibleConnections,
            'S3 compatible'
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
    // Pure FlashBlade related methods:
    // --------------------------------------
    flashBladeOnValidate(values, existingConnections) {
        const flashBladeConnections = existingConnections
            .filter(connection => connection.service === 'FLASHBLADE');

        return _onS3LikeValidate(
            s3LikeConnKeyMappings['FLASHBLADE'],
            values,
            flashBladeConnections,
            'FlashBlade'
        );
    }

    async flashBladeOnValidateAsync(values) {
        return _onS3LikeValidateAsync(
            s3LikeConnKeyMappings['FLASHBLADE'],
            values,
            'FLASHBLADE',
            'FlashBlade',
            'AWS_V4'
        );
    }

    // --------------------------------------
    // Net Storage related methods:
    // --------------------------------------
    nsOnValidate(values) {
        const errors = {};
        const { nsStorageGroup, nsKeyName, nsCPCode, nsAuthKey } = values;

        if (!nsStorageGroup) {
            errors.nsStorageGroup = 'Please enter a valid storage group';
        }

        if (!nsKeyName) {
            errors.nsKeyName = 'Enter a valid key name';
        }

        if (!Number(nsCPCode) || nsCPCode.length !== 6 ) {
            errors.nsCPCode = 'Enter a 6 digit CP Code';
        }

        if (!nsAuthKey) {
            errors.nsAuthKey = 'Please enter a valid authentication key';
        }

        return errors;
    }

    async nsOnValidateAsync(values) {
        const errors = {};
        const { nsHostname, nsStorageGroup, nsKeyName, nsCPCode, nsAuthKey } = values;
        const { status } = await api.account.check_external_connection({
            endpoint_type: 'NET_STORAGE',
            endpoint: `${nsStorageGroup}-${nsHostname}`,
            identity: nsKeyName,
            secret: nsAuthKey,
            cp_code: nsCPCode
        });

        switch (status) {
            case 'UNKNOWN_FAILURE': {
                // Using empty message to mark the fields as invalid.
                errors.nsStorageGroup =
                    errors.nsKeyName =
                    errors.nsCPCode =
                    errors.nsAuthKey =
                    errors.global = '';
                break;
            }
        }

        return errors;
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
    viewModel: AddCloudConnectionModalViewModel,
    template: template
};
