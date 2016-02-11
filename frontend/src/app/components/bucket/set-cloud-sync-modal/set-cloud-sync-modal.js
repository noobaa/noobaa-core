import template from './set-cloud-sync-modal.html';
import ko from 'knockout';
import { cloudSyncPolicy, awsCredentialsList, awsBucketList } from 'model';
import { loadCloudSyncPolicy, loadAccountAwsCredentials, loadAwsBucketList, 
    setCloudSyncPolicy } from 'actions';

const frequencyUnitOptions = Object.freeze([
     { value: 1, label: 'Minutes' },
     { value: 60, label: 'Hours' },
     { value: 60 * 24, label: 'Days' }
]);

const directionOptions = Object.freeze([
    { value: 'BI', label: 'Bi-Direcitonal' },
    { value: 'NB2AWS', label: 'NooBaa to AWS' },
    { value: 'AWS2NB', label: 'AWS to NooBaa' }
]);

const addAccessKeyOption = {
    label: 'Add new access key',
    value: null
}

class CloudSyncModalViewModel {
    constructor({ bucketName, onClose }) {
        this.onClose = onClose;
        this.bucketName = bucketName;

        this.accessKey = ko.observable();
        this.accessKeyOptions = ko.pureComputed(
            () => [
                //addAccessKeyOption,
                 //null,
                ...awsCredentialsList().map(
                    ({ access_key }) => ({ value: access_key })
                )
            ]
        );

        this.awsCredentials = ko.pureComputed(
            () => awsCredentialsList().find(
                credentials => credentials.access_key === this.accessKey()
            )
        );

        // // Leaks memory
        // this.awsCredentials.subscribe(
        //     ({ access_key, secret_key }) => loadAwsBucketList(access_key, secret_key)
        // );

        this.awsBucket = ko.observable();
        this.awsBucketsOptions = awsBucketList.map(
            () => bucketName => ({ value: bucketName })
        );

       
        // this.direction = ko.observableWithDefault(
        //     () => {
        //         let policy = cloudSyncPolicy();
        //         if (!policy) return;

        //         let { n2c_enabled, c2n_enabled } = policy;
        //         if (n2c_enabled && c2n_enabled) return 'BI';
        //         if (n2c_enabled) return 'NB2AWS';
        //         if (c2n_enabled) return 'AWS2NB';
        //     }
        // );

        // this.directionOptions = directionOptions;
        
        // let calculatedUnit = ko.pureComputed(
        //     () => {
        //         let policy = cloudSyncPolicy();
        //         if (!policy) return 60;

        //         let { schedule } = policy;
        //         if (schedule < 60) {
        //             return 1; 

        //         } else if (schedule < 60 * 24){
        //             return 60;

        //         } else {
        //             return 60 * 24
        //         }
        //     }
        // );

        // this.frequencyUnit = ko.observableWithDefault(
        //     () =>  calculatedUnit()
        // );

        // this.frequency = ko.observableWithDefault(
        //     () => cloudSyncPolicy() ?
        //         Math.floor(cloudSyncPolicy().schedule / calculatedUnit()) :
        //         1
        // );
        
        // this.frequencyUnitOptions = frequencyUnitOptions;

        // this.syncDeletions = ko.observableWithDefault(
        //     () => cloudSyncPolicy() && !cloudSyncPolicy().additions_only
        // );

        // this.isAWSCredentialsModalVisible = ko.observable(false);

        // loadCloudSyncPolicy(ko.unwrap(this.bucketName));
        loadAccountAwsCredentials();
    }

    cancel() {
        this.onClose();
    }

    save() {
        // setCloudSyncPolicy(
        //     ko.unwrap(this.bucketName),
        //     this.awsBucket(),
        //     this.awsCredentials(),
        //     this.direction(),
        //     this.frequency() * this.frequencyUnit(),
        //     this.syncDeletions()
        // );
        this.onClose();
    }
}

export default {
    viewModel: CloudSyncModalViewModel,
    template: template
}