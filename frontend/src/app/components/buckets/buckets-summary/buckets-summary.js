/* Copyright (C) 2016 NooBaa */

import template from './buckets-summary.html';
import ConnectableViewModel from 'components/connectable';
import { sumBy } from 'utils/core-utils';
import { formatSize, sumSize, toBigInteger, toBytes, fromBigInteger } from 'utils/size-utils';
import ko from 'knockout';
import numeral from 'numeral';

const reducationSavingTooltips = 'Savings shows the uncompressed and non-deduped data that would have been stored without those techniques';

class BucketsSummaryViewModel extends ConnectableViewModel {
    dataReady = ko.observable();
    bucketsCount = ko.observable();
    objectCount = ko.observable();
    nsBucketCount = ko.observable();
    nsReadsWrites = ko.observable();
    dataWritten = ko.observable();
    reducationSaving = ko.observable();
    reducationSavingTooltips = reducationSavingTooltips;


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
            const dataSize = sumSize(...bucketList.map(bucket => bucket.data.size));
            const reducedSize = sumSize(...bucketList.map(bucket => bucket.data.sizeReduced));
            const savings = fromBigInteger(toBigInteger(dataSize).subtract(reducedSize));
            const savingsRatio = dataSize > 0 ? toBytes(savings) / toBytes(dataSize) : 0;
            const nsBucketList = Object.values(nsBuckets);
            const nsBucketCount = nsBucketList.length;
            const nsReads = sumBy(nsBucketList, bucket => bucket.io.readCount);
            const nsWrites = sumBy(nsBucketList, bucket => bucket.io.writeCount);

            ko.assignToProps(this, {
                dataReady: true,
                bucketsCount: numeral(bucketCount).format(','),
                objectCount: numeral(objectCount).format(','),
                nsBucketCount: numeral(nsBucketCount).format(','),
                nsReadsWrites: `${numeral(nsReads).format(',')}/${numeral(nsWrites).format(',')}`,
                dataWritten: formatSize(dataSize),
                reducationSaving: `${formatSize(savings)} (${numeral(savingsRatio).format('%')})`
            });
        }
    }
}

export default {
    viewModel: BucketsSummaryViewModel,
    template: template
};
