import template from './cloud-sync-modal.html';
import ko from 'knockout';
import { makeRange } from 'utils';
import { /*awsCredentialsList,*/ awsBucketList } from 'model';
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


let awsCredentialsList = ko.observableArray([
    { access_key: 'AKIAJOP7ZFXOOPGL5BOA', secret_key: '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' },
    { access_key: 'AKIAIKFRM4EAAO5TAXJA', secret_key: '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' }
]);

class CloudSyncModalViewModel {
    constructor({ bucketName, onClose }) {
        this.onClose = onClose;
        this.bucketName = bucketName;

        this.syncUnitsOptions = syncUnitsOptions;
        this.syncTypeOptions = syncTypeOptions;
        this.accessKeySuggestions = awsCredentialsList.map(
            ({ access_key }) => access_key 
        );
        
        this.accessKey = ko.observable();

        let _secretKey = ko.observable(); 
        this.secretKey = ko.pureComputed(
            () => _secretKey() || awsCredentialsList().find(
                ({ access_key }) => access_key === this.accessKey() 
            )  
        );

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