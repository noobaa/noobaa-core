import template from './cloud-sync-modal.html';
import ko from 'knockout';
import { makeRange } from 'utils';
import { awsCredentialList, awsBucketList } from 'model';
import { loadCloudSyncPolicy, loadAccountAwsCredentials, loadAwsBucketList } from 'actions';

const  [ MINUTES, HOURS, DAYS ] = makeRange(3);
const syncUnitsOptions = Object.freeze([
     { value: MINUTES, label: 'Minutes' },
     { value: HOURS, label: 'Hours' },
     { value: DAYS, label: 'Days' }
]);


const [ BI, NB2AWS, AWS2NB ] = makeRange(3);
const syncTypeOptions = Object.freeze([
    { value: BI, label: 'Bi-Direcitonal' },
    { value: NB2AWS, label: 'NooBaa to AWS' },
    { value: AWS2NB, label: 'AWS to NooBaa' }
]);

const ADD_NEW = 1;
const newCredentialOption = Object.freeze({ 
    label: '+ Add AWS Credentials...', 
    value: ADD_NEW 
});

class CloudSyncModalViewModel {
    constructor({ bucketName, onClose }) {
        this.onClose = onClose;
        this.bucketName = bucketName;

        this.syncUnitsOptions = syncUnitsOptions;
        this.syncTypeOptions = syncTypeOptions;
        this.credentialOptions = ko.observableWithDefault(
            () => {
                let credentialList = awsCredentialList();

                if (!credentialList) {
                    return [];

                } else if (credentialList.length === 0) {
                    return [newCredentialOption];

                } else {
                    let options = credentialList.map(
                        credential => ({ 
                            label: credential.access_key,  
                            value: credential
                        })
                    );

                    return [].concat(newCredentialOption, null, options);
                }
            }
        );

        this.awsCredentials = ko.observable({});
        this.awsCredentials.subscribe(() => this.tryLoadAwsBucketList())

        this.newCredentialsFieldsVisible = ko.observable(false);
        this.selectedCredentials = ko.pureComputed({
            read: this.awsCredentials,
            write: val => val === ADD_NEW ? 
                this.newCredentialsFieldsVisible(true) : 
                this.awsCredentials(val)
        });

        this.newAccessKey = ko.observable()
            .extend({ required: true });

        this.newSecretKey = ko.observable()
            .extend({ required: true });

        this.awsBucketsOptions = ko.observableWithDefault(
            () => awsBucketList() && awsBucketList().map(
                    bucketName => ({ value: bucketName })
                )
        );

        this.awsBucket = ko.observable();
        this.syncType = ko.observable(BI);
        this.syncDeletions = ko.observable(false);
        this.syncCycle = ko.observable(1);
        this.syncCycleUnit = ko.observable(HOURS)

        loadCloudSyncPolicy(ko.unwrap(this.bucketName));
        loadAccountAwsCredentials();
    }

    tryLoadAwsBucketList() {
        let { accessKey, secretKey } = this.awsCredentials();
        if (accessKey && secretKey) {
            loadAwsBucketList(accessKey, secretKey);
        }
    }

    cancelNewCredentials() {
        this.newAccessKey(null);
        this.newSecretKey(null)
        this.newCredentialsFieldsVisible(false);
    }

    useNewCredentials() {
        this.awsCredentials({
            access_key: this.newAccessKey(),
            secretKey: this.newSecretKey()
        });

        this.newCredentialsFieldsVisible(false);
    }

    cancel() {
        this.onClose();
    }

    save() {
        this.onClose();
    }
}

export default {
    viewModel: CloudSyncModalViewModel,
    template: template
}