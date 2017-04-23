/* Copyright (C) 2016 NooBaa */

import template from './bucket-s3-access-list.html';
import BaseViewModel from 'components/base-view-model';
import ko from 'knockout';
import { systemInfo } from 'model';
import { openBucketS3AccessModal, openS3AccessDetailsModal } from 'dispatchers';

class BucketS3AccessListViewModel extends BaseViewModel {
    constructor({ bucketName }) {
        super();

        this.accessList = ko.pureComputed(
            () => (systemInfo() ? systemInfo().accounts : [])
                .filter(
                    account => (account.allowed_buckets || [])
                        .includes(ko.unwrap(bucketName))
                )
                .map(
                    account => account.email
                )
        );

        this.isListEmpty = ko.pureComputed(
            () => this.accessList().length === 0
        );

        this.selectedAccount = ko.observable();

        this.bucketName = bucketName;
    }

    onEditS3Access() {
        openBucketS3AccessModal(
            ko.unwrap(this.bucketName)
        );
    }

    onConnectionDetails(email) {
        openS3AccessDetailsModal(email);
    }
}

export default {
    viewModel: BucketS3AccessListViewModel,
    template: template
};
