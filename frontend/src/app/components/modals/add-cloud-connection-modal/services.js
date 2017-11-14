import awsFieldsTemplate from './aws-fields.html';
import azureFieldsTemplate from './azure-fields.html';
import s3CompatibleFieldsTemplate from './s3-compatible-fields.html';
import netStorageTemplate from './net-storage.html';
import { deepFreeze } from 'utils/core-utils';
import { isUri } from 'utils/browser-utils';
import { api } from 'services';

const aws = {
    option: {
        label: 'AWS S3',
        icon: 'aws-s3-dark',
        selectedIcon: 'aws-s3-colored',
        remark: 'https://s3.amazonaws.com'
    },
    template: awsFieldsTemplate,
    form: {
        fields: {
            endpoint: 'https://s3.amazonaws.com',
            accessKey: '',
            secretKey: ''
        },
        asyncTriggers: ['endpoint', 'accessKey', 'secretKey'],
        onValidate: (values, existingConnections) => {
            const errors = {};
            const { endpoint, accessKey, secretKey } = values;

            if (!isUri(endpoint)) {
                errors.endpoint = 'Please enter valid AWS endpoint URI';
            }

            if (!accessKey) {
                errors.accessKey = 'Please enter an AWS access key';

            } else {
                const alreadyExists = existingConnections
                    .some(connection =>
                        connection.service === 'AWS' &&
                        connection.endpoint === endpoint &&
                        connection.identity === accessKey
                    );

                if (alreadyExists) {
                    errors.accessKey = 'A similar connection already exists';
                }
            }

            if (!secretKey) {
                errors.secretKey = 'Please enter an AWS secret key';
            }

            return errors;
        },
        onValidateAsync: async (values) => {
            const errors = {};
            const { endpoint, accessKey, secretKey } = values;
            const { status, error } = await api.account.check_external_connection({
                endpoint_type: 'AWS',
                endpoint: endpoint,
                identity: accessKey,
                secret: secretKey
            });

            switch(status) {
                case 'TIMEOUT': {
                    errors.endpoint = 'AWS connection timed out';
                    break;
                }
                case 'INVALID_ENDPOINT': {
                    errors.endpoint = 'Please enter a valid AWS endpoint';
                    break;
                }
                case 'INVALID_CREDENTIALS': {
                    errors.secretKey = errors.accessKey = 'Credentials does not match';
                    break;
                }
                case 'NOT_SUPPORTED': {
                    errors.accessKey = 'Account type is not supported';
                    break;
                }
                case 'TIME_SKEW': {
                    errors.accessKey = 'Time difference with the server is too large';
                    break;
                }
                case 'UNKNOWN_FAILURE': {
                   // Using empty message to mark the fields as invalid.
                    errors.endpoint = errors.accessKey = errors.secretKey = '';
                    errors.global = error.message;
                    break;
                }
            }

            return errors;
        }
    }
};

const azure = {
    option: {
        label: 'Microsoft Azure',
        icon: 'azure-dark',
        selectedIcon: 'azure-colored',
        remark: 'https://blob.core.windows.net'
    },
    template: azureFieldsTemplate,
    form: {
        fields: {
            endpoint: 'https://blob.core.windows.net',
            accountName: '',
            accountKey: ''
        },
        asyncTriggers: ['endpoint', 'accountName', 'accountKey'],
        onValidate: (values, existingConnections) => {
            const { endpoint, accountName, accountKey } = values;
            const errors = {};

            if (!isUri(endpoint)) {
                errors.endpoint = 'Please enter valid Azure endpoint URI';
            }

            if (!accountName) {
                errors.accountName = 'Please enter an Azure acount name';

            } else {
                const alreadyExists = existingConnections
                    .some(connection =>
                        connection.service === 'AZURE' &&
                        connection.endpoint === endpoint &&
                        connection.identity === accountName
                    );

                if (alreadyExists) {
                    errors.accountName = 'A similar connection already exists';
                }
            }

            if (!accountKey) {
                errors.accountKey = 'Please enter an Azure account key';
            }

            return errors;
        },
        onValidateAsync: async values => {
            const errors = {};
            const { endpoint, accountKey, accountName } = values;
            const { status, error } = await api.account.check_external_connection({
                endpoint_type: 'AZURE',
                endpoint: endpoint,
                identity: accountName,
                secret: accountKey
            });

            switch(status) {
                case 'TIMEOUT': {
                    errors.endpoint = 'Azure connection timed out';
                    break;
                }
                case 'INVALID_ENDPOINT': {
                    errors.endpoint = 'Please enter a valid Azure endpoint';
                    break;
                }
                case 'INVALID_CREDENTIALS': {
                    errors.accountName = errors.accountKey = 'Credentials does not match';
                    break;
                }
                case 'NOT_SUPPORTED': {
                    errors.accountName = 'Account type is not supported';
                    break;
                }
                case 'TIME_SKEW': {
                    errors.accountName = 'Time difference with the server is too large';
                    break;
                }
                case 'UNKNOWN_FAILURE': {
                   // Using empty message to mark the fields as invalid.
                    errors.endpoint = errors.accountName = errors.accountKey = '';
                    errors.global = error.message;
                    break;
                }
            }

            return errors;
        }
    }
};

const s3Compatible = {
    option: {
        label: 'Generic S3 Compatible Service',
        icon: 'cloud-dark',
        selectedIcon: 'cloud-colored',
        remark: 'No default endpoint'
    },
    template: s3CompatibleFieldsTemplate,
    form: {
        fields: {
            endpoint: '',
            accessKey: '',
            secretKey: ''
        },
        asyncTriggers: ['endpoint', 'accessKey', 'secretKey'],
        onValidate: (values, existingConnections)  => {
            const errors = {};
            const { endpoint, accessKey, secretKey } = values;

            if (!isUri(endpoint)) {
                errors.endpoint = 'Please enter valid S3 compatible endpoint URI';
            }

            if (!accessKey) {
                errors.accessKey = 'Please enter an access key';

            } else {
                const alreadyExists = existingConnections
                    .some(connection =>
                        connection.service === 'S3_COMPATIBLE' &&
                        connection.endpoint === endpoint &&
                        connection.identity === accessKey
                    );

                if (alreadyExists) {
                    errors.accessKey = 'A similar connection already exists';
                }
            }

            if (!secretKey) {
                errors.secretKey = 'Please enter a secret key';
            }

            return errors;
        },
        onValidateAsync: async values => {
            const errors = {};
            const { endpoint, accessKey, secretKey } = values;
            const { status, error } = await api.account.check_external_connection({
                endpoint_type: 'AWS',
                endpoint: endpoint,
                identity: accessKey,
                secret: secretKey
            });

            switch(status) {
                case 'TIMEOUT': {
                    errors.endpoint = 'S3 connection timed out';
                    break;
                }
                case 'INVALID_ENDPOINT': {
                    errors.endpoint = 'Please enter a valid S3 compatible endpoint';
                    break;
                }
                case 'INVALID_CREDENTIALS': {
                    errors.accessKey = errors.accessKey = 'Credentials does not match';
                    break;
                }
                case 'NOT_SUPPORTED': {
                    errors.accessKey = 'Account type is not supported';
                    break;
                }
                case 'TIME_SKEW': {
                    errors.accessKey = 'Time difference with the server is too large';
                    break;
                }
                case 'UNKNOWN_FAILURE': {
                   // Using empty message to mark the fields as invalid.
                    errors.endpoint = errors.accessKey = errors.secretKey = '';
                    errors.global = error.message;
                    break;
                }
            }

            return errors;
        }
    }
};

const netStorage = {
    option: {
        label: 'Akamai NetStorage',
        icon: 'net-storage',
        remark: 'No default endpoint'
    },
    template: netStorageTemplate,
    form: {
        fields:{
            hostname: 'nsu.akamaihd.net',
            storageGroup: '',
            keyName: '',
            cpCode: '',
            authKey: ''
        },
        asyncTriggers: ['storageGroup', 'hostname', 'keyName', 'cpCode', 'authKey'],
        onValidate: (values) => {
            const errors = {};
            const { storageGroup, keyName, cpCode, authKey } = values;

            if (!storageGroup) {
                errors.storageGroup = 'Please enter a valid storage group';
            }

            if (!keyName) {
                errors.keyName = 'Enter a valid key name';
            }

            if (!Number(cpCode) || cpCode.length !== 6 ) {
                errors.cpCode = 'Enter a 6 digit CP Code';
            }

            if (!authKey) {
                errors.authKey = 'Please enter a valid authentication key';
            }

            return errors;
        },
        onValidateAsync: async values => {
            const errors = {};
            const { storageGroup, hostname, keyName, cpCode, authKey } = values;
            const { status } = await api.account.check_external_connection({
                endpoint_type: 'NET_STORAGE',
                endpoint: `${storageGroup}-${hostname}`,
                identity: keyName,
                secret: authKey,
                cp_code: cpCode
            });

            switch(status) {
                case 'UNKNOWN_FAILURE': {
                    // Using empty message to mark the fields as invalid.
                    errors.storageGroup =
                        errors.keyName =
                        errors.cpCode =
                        errors.authKey =
                        errors.global = '';
                    break;
                }
            }

            return errors;
        }
    }
};

export default deepFreeze({
    AWS: aws,
    AZURE: azure,
    S3_COMPATIBLE: s3Compatible,
    NET_STORAGE: netStorage
});

