/* Copyright (C) 2016 NooBaa */

import template from './buckets-summary.html';
import ConnectableViewModel from 'components/connectable';
import { sumBy } from 'utils/core-utils';
import { stringifyAmount } from 'utils/string-utils';
import ko from 'knockout';

class BucketsSummaryViewModel extends ConnectableViewModel {
    dataReady = ko.observable();
    bucketSummary = ko.observable();
    nsBucketSummary = ko.observable();

    selectState(state) {
        return [
            state.buckets,
            state.namespaceBuckets
        ];
    }

    mapStateToProps(buckets, nsBuckets) {
        if (!buckets || !nsBuckets) {
            ko.assignToProps(this, {
                dataReady: false
            });

        } else {
            const bucketList = Object.values(buckets);
            const bucketCount = bucketList.length;
            const objectCount = sumBy(bucketList, bucket => bucket.objectCount);
            let bucketSummary = stringifyAmount('bucket', bucketCount, 'No');
            if (bucketCount > 0) {
                bucketSummary += ` | ${stringifyAmount('object', objectCount)}`;
            }

            const nsBucketCount = Object.values(nsBuckets).length;
            const nsBucketSummary = stringifyAmount('bucket', nsBucketCount, 'No');

            ko.assignToProps(this, {
                dataReady: true,
                bucketSummary,
                nsBucketSummary
            });
        }
    }
}

export default {
    viewModel: BucketsSummaryViewModel,
    template: template
};
