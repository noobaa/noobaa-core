import { deepFreeze } from 'utils/core-utils';

export default deepFreeze({
    AWS: {
        defaultEndpoint: 'https://s3.amazonaws.com',
        option: {
            label: 'AWS S3',
            icon: 'aws-s3-resource-dark',
            selectedIcon: 'aws-s3-resource-colored'
        },
        identity: {
            label: 'Access Key',
            placeholder: 'Enter key',
            requiredMessage: 'Please enter an AWS access key',
            duplicateMessage: 'Access key already used in another AWS connection'
        },
        secret: {
            label: 'Secret Key',
            placeholder: 'Enter secret',
            requiredMessage: 'Please enter an AWS secret key'
        }
    },
    AZURE: {
        defaultEndpoint: 'https://blob.core.windows.net',
        option: {
            label: 'Microsoft Azure',
            icon: 'azure-resource-dark',
            selectedIcon: 'azure-resource-colored'
        },
        identity: {
            label: 'Account Name',
            placeholder: 'Enter name',
            requiredMessage: 'Please enter an Azure acount name',
            duplicateMessage: 'Account name already used in another azure connection'
        },
        secret: {
            label: 'Account Key',
            placeholder: 'Enter key',
            requiredMessage: 'Please enter an Azure account key'
        }
    },
    S3_COMPATIBLE: {
        option: {
            label: 'Generic S3 Compatible Service',
            icon: 'cloud-resource-dark',
            selectedIcon: 'cloud-resource-colored'
        },
        identity: {
            label: 'Access Key',
            placeholder: 'Enter key',
            requiredMessage: 'Please enter an access key',
            duplicateMessage: 'Access key already used in another S3 compatible connection'
        },
        secret: {
            label: 'Secret Key',
            placeholder: 'Enter secret',
            requiredMessage: 'Please enter a secret key'
        }
    }
});
