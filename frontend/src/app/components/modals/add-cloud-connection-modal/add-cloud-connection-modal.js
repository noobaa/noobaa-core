/* Copyright (C) 2016 NooBaa */

import template from './add-cloud-connection-modal.html';
import awsFieldsTemplate from './aws-fields.html';
import azureFieldsTemplate from './azure-fields.html';
import s3CompatibleFieldsTemplate from './s3-compatible-fields.html';
import netStorageTemplate from './net-storage-fields.html';
import googleCloudTemplate from './google-cloud-fields.html';
import Observer from 'observer';
import ko from 'knockout';
import { deepFreeze, pick, isUndefined } from 'utils/core-utils';
import { getFieldValue, getFieldError } from 'utils/form-utils';
import { isUri, readFileAsText } from 'utils/browser-utils';
import { all, sleep } from 'utils/promise-utils';
import { getMany } from 'rx-extensions';
import { addExternalConnection, updateForm, untouchForm, closeModal } from 'action-creators';
import { api } from 'services';
import { state$, action$ } from 'state';

const nameRegExp = /^Connection (\d+)$/;
const defaultService = 'AWS';
const gcEndpoint = 'www.googleapis.com';
const gcValidateFailureMessage = 'Try to regenerate and upload a new file';

const serviceOptions = deepFreeze([
    {
        value: 'AWS',
        label: 'AWS S3',
        icon: 'aws-s3-dark',
        selectedIcon: 'aws-s3-colored',
        remark: 'https://s3.amazonaws.com'
    },
    {
        value: 'AZURE',
        label: 'Microsoft Azure',
        icon: 'azure-dark',
        selectedIcon: 'azure-colored',
        remark: 'https://blob.core.windows.net'
    },
    {
        value: 'GOOGLE',
        label: 'Google Cloud',
        icon: 'google-cloud-dark',
        selectedIcon: 'google-cloud-colored',
        remark: gcEndpoint
    },
    {
        value: 'S3_V2_COMPATIBLE',
        label: 'Generic S3 V2 Compatible Service',
        icon: 'cloud-v2-dark',
        selectedIcon: 'cloud-v2-colored',
        remark: 'No default endpoint'
    },
    {
        value: 'S3_V4_COMPATIBLE',
        label: 'Generic S3 V4 Compatible Service',
        icon: 'cloud-v4-dark',
        selectedIcon: 'cloud-v4-colored',
        remark: 'No default endpoint'
    },
    {
        value: 'NET_STORAGE',
        label: 'Akamai NetStorage',
        icon: 'net-storage',
        remark: 'No default endpoint'
    }
]);

const templates = deepFreeze({
    AWS: awsFieldsTemplate,
    AZURE: azureFieldsTemplate,
    S3_V2_COMPATIBLE: s3CompatibleFieldsTemplate,
    S3_V4_COMPATIBLE: s3CompatibleFieldsTemplate,
    NET_STORAGE: netStorageTemplate,
    GOOGLE: googleCloudTemplate
});

const asyncTriggers = deepFreeze([
    'service',
    'awsEndpoint',
    'awsAccessKey',
    'awsSecretKey',
    'azureEndpoint',
    'azureAccountName',
    'azureAccountKey',
    's3Endpoint',
    's3AccessKey',
    's3SecretKey',
    'nsHostname',
    'nsStorageGroup',
    'nsKeyName',
    'nsCPCode',
    'nsAuthKey',
    'gcKeysFileName',
    'gcKeysJson'
]);

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

class AddCloudConnectionModalViewModel extends Observer  {
    formName = this.constructor.name;
    fields = ko.observable();
    asyncTriggers = asyncTriggers;
    allowedServices = null;
    service = '';
    serviceOptions = null;
    existingConnections = null;
    form = null;
    subTemplate = ko.observable();
    isFormInitialized = ko.observable();
    globalError = ko.observable();

    constructor({ allowedServices = serviceOptions.map(opt => opt.value) }){
        super();

        this.serviceOptions = serviceOptions
            .filter(opt => allowedServices.includes(opt.value));

        this.observe(
            state$.pipe(
                getMany(
                    'accounts',
                    ['session', 'user'],
                    ['forms', this.constructor.name]
                )
            ),
            this.onState
        );
    }

    onState([accounts, user, form]) {
        if (!accounts || !user) {
            return;
        }

        this.globalError(form ? getFieldError(form, 'global') : '');
        this.existingConnections = accounts[user].externalConnections;

        const service = form ? getFieldValue(form, 'service') : defaultService;
        if (this.service !== service) {
            this.service = service;
            this.subTemplate(templates[service]);

            // Clear the touch state of the form whenever the
            // service changes.
            action$.next(untouchForm(this.formName));
        }

        if (!this.fields()) {
            this.fields({
                // Common fields
                connectionName: _suggestConnectionName(this.existingConnections),
                service: this.service,

                // AWS fields.
                awsEndpoint: 'https://s3.amazonaws.com',
                awsAccessKey: '',
                awsSecretKey: '',

                // Azure fields.
                azureEndpoint: 'https://blob.core.windows.net',
                azureAccountName: '',
                azureAccountKey: '',

                // S3 compatible fileds.
                s3Endpoint: '',
                s3AccessKey: '',
                s3SecretKey: '',

                // Net Storage fileds.
                nsHostname: 'nsu.akamaihd.net',
                nsStorageGroup: '',
                nsKeyName: '',
                nsCPCode: '',
                nsAuthKey: '',

                // Google Cloud field.
                gcKeysFileName: '',
                gcKeysJson: ''
            });
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
            (service === 'S3_V2_COMPATIBLE' && this.s3OnValidate) ||
            (service === 'S3_V4_COMPATIBLE' && this.s3OnValidate) ||
            (service === 'NET_STORAGE' && this.nsOnValidate) ||
            (service === 'GOOGLE' && this.gcOnValidate) ||
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
            (service === 'S3_V2_COMPATIBLE' && this.s3OnValidateAsync) ||
            (service === 'S3_V4_COMPATIBLE' && this.s3OnValidateAsync) ||
            (service === 'NET_STORAGE' && this.nsOnValidateAsync) ||
            (service === 'GOOGLE' && this.gcOnValidateAsync) ||
            _getEmptyObj;


        return await serviceValidateAsync(values);
    }

    onSubmit(values) {
        const { connectionName, service } = values;
        const fields =
            (service === 'AWS' && ['awsEndpoint', 'awsAccessKey', 'awsSecretKey']) ||
            (service === 'AZURE' && ['azureEndpoint', 'azureAccountName', 'azureAccountKey']) ||
            (service === 'S3_V2_COMPATIBLE' && ['s3Endpoint', 's3AccessKey', 's3SecretKey']) ||
            (service === 'S3_V4_COMPATIBLE' && ['s3Endpoint', 's3AccessKey', 's3SecretKey']) ||
            (service === 'NET_STORAGE' && ['nsHostname', 'nsStorageGroup', 'nsKeyName', 'nsCPCode', 'nsAuthKey']) ||
            (service === 'GOOGLE' && ['gcKeysJson']);

        const params = pick(values, fields);
        if (service === 'GOOGLE') params.gcEndpoint = gcEndpoint;

        action$.next(addExternalConnection(connectionName, service, params));
        action$.next(closeModal());
    }

    onCancel() {
        action$.next(closeModal());
    }

    // --------------------------------------
    // AWS related methods:
    // --------------------------------------
    awsOnValidate(values, existingConnections) {
        const errors = {};
        const { awsEndpoint, awsAccessKey, awsSecretKey } = values;

        if (!isUri(awsEndpoint)) {
            errors.awsEndpoint = 'Please enter valid AWS endpoint URI';
        }

        if (!awsAccessKey) {
            errors.awsAccessKey = 'Please enter an AWS access key';

        } else {
            const alreadyExists = existingConnections
                .some(connection =>
                    connection.service === 'AWS' &&
                    connection.endpoint === awsEndpoint &&
                    connection.identity === awsAccessKey
                );

            if (alreadyExists) {
                errors.awsAccessKey = 'A similar connection already exists';
            }
        }

        if (!awsSecretKey) {
            errors.awsSecretKey = 'Please enter an AWS secret key';
        }

        return errors;
    }

    async awsOnValidateAsync(values) {
        const errors = {};
        const { awsEndpoint, awsAccessKey, awsSecretKey } = values;
        const { status, error } = await api.account.check_external_connection({
            endpoint_type: 'AWS',
            endpoint: awsEndpoint,
            identity: awsAccessKey,
            secret: awsSecretKey
        });

        switch (status) {
            case 'TIMEOUT': {
                errors.awsEndpoint = 'AWS connection timed out';
                break;
            }
            case 'INVALID_ENDPOINT': {
                errors.awsEndpoint = 'Please enter a valid AWS endpoint';
                break;
            }
            case 'INVALID_CREDENTIALS': {
                errors.awsSecretKey = errors.awsAccessKey = 'Credentials do not match';
                break;
            }
            case 'NOT_SUPPORTED': {
                errors.awsAccessKey = 'Account type is not supported';
                break;
            }
            case 'TIME_SKEW': {
                errors.awsAccessKey = 'Time difference with the server is too large';
                break;
            }
            case 'UNKNOWN_FAILURE': {
                // Using empty message to mark the fields as invalid.
                errors.awsEndpoint = errors.awsAccessKey = errors.awsSecretKey = '';
                errors.global = error.message;
                break;
            }
        }

        return errors;
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
    // S3 Compatible related methods:
    // --------------------------------------
    s3OnValidate(values, existingConnections) {
        const errors = {};
        const { s3Endpoint, s3AccessKey, s3SecretKey } = values;

        if (!isUri(s3Endpoint)) {
            errors.s3Endpoint = 'Please enter valid S3 compatible endpoint URI';
        }

        if (!s3AccessKey) {
            errors.s3AccessKey = 'Please enter an access key';

        } else {
            const alreadyExists = existingConnections
                .some(connection =>
                    (['S3_V2_COMPATIBLE', 'S3_V4_COMPATIBLE'].includes(connection.service)) &&
                    connection.endpoint === s3Endpoint &&
                    connection.identity === s3AccessKey
                );

            if (alreadyExists) {
                errors.s3AccessKey = 'A similar connection already exists';
            }
        }

        if (!s3SecretKey) {
            errors.s3SecretKey = 'Please enter a secret key';
        }

        return errors;
    }

    async s3OnValidateAsync(values) {
        const errors = {};
        const { s3Endpoint, s3AccessKey, s3SecretKey } = values;
        const { status, error } = await api.account.check_external_connection({
            endpoint_type: 'AWS',
            endpoint: s3Endpoint,
            identity: s3AccessKey,
            secret: s3SecretKey
        });

        switch (status) {
            case 'TIMEOUT': {
                errors.s3Endpoint = 'S3 connection timed out';
                break;
            }
            case 'INVALID_ENDPOINT': {
                errors.s3Endpoint = 'Please enter a valid S3 compatible endpoint';
                break;
            }
            case 'INVALID_CREDENTIALS': {
                errors.s3AccessKey = errors.s3SecretKey = 'Credentials do not match';
                break;
            }
            case 'NOT_SUPPORTED': {
                errors.s3AccessKey = 'Account type is not supported';
                break;
            }
            case 'TIME_SKEW': {
                errors.s3AccessKey = 'Time difference with the server is too large';
                break;
            }
            case 'UNKNOWN_FAILURE': {
                // Using empty message to mark the fields as invalid.
                errors.s3Endpoint = errors.s3AccessKey = errors.s3SecretKey = '';
                errors.global = error.message;
                break;
            }
        }

        return errors;
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
        action$.next(updateForm(this.formName, { gcKeysFileName, gcKeysJson }));
    }
}

export default {
    viewModel: AddCloudConnectionModalViewModel,
    template: template
};
