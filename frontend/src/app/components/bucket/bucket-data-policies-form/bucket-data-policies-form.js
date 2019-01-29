/* Copyright (C) 2016 NooBaa */

import template from './bucket-data-policies-form.html';
import ConnectableViewModel from 'components/connectable';
import ko from 'knockout';

class BucketDataPoliciesFormViewModel extends ConnectableViewModel {
    dataReady = ko.observable();

    selectState(state) {
        const { buckets, location } = state;
        const bucketName = location.params.bucket;
        return [
            Boolean(buckets && buckets[bucketName])
        ];
    }

    mapStateToProps(bucketLoaded) {
        ko.assignToProps(this, {
            dataReady: bucketLoaded
        });
    }
}

export default {
    viewModel: BucketDataPoliciesFormViewModel,
    template: template
};
