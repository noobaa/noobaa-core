/* Copyright (C) 2016 NooBaa */

import template from './namespace-bucket-summary.html';
import ConnectableViewModel from 'components/connectable';
import ko from 'knockout';
import moment from 'moment';
import { timeShortFormat } from 'config';
import { getNamespaceBucketStateIcon } from 'utils/bucket-utils';
import { stringifyAmount } from 'utils/string-utils';
import numeral from 'numeral';

class NamespaceBucketSummaryViewModel extends ConnectableViewModel {
    state = {
        name: ko.observable(),
        css: ko.observable(),
        tooltip: ko.observable()
    };
    dataReady = ko.observable();
    writePolicy = ko.observable();
    readPolicy = ko.observable();
    readCount = ko.observable();
    writeCount = ko.observable();
    lastRead = ko.observable();
    lastWrite = ko.observable();

    selectState(state, params) {
        const { namespaceBuckets: buckets } = state;
        return [
            buckets && buckets[params.bucket]
        ];
    }

    mapStateToProps(bucket) {
        if (!bucket) {
            ko.assignToProps(this, {
                dataReady: false
            });

        } else {
            const { readFrom, writeTo } = bucket.placement;
            const state = getNamespaceBucketStateIcon(bucket);
            const readPolicyText = readFrom.length === 1 ?
                readFrom[0] :
                stringifyAmount('resource', readFrom.length);

            const { lastRead ,lastWrite, readCount, writeCount } = bucket.io;
            const lastReadText = lastRead >= 0 ? moment(lastRead).format(timeShortFormat) : 'Never Read';
            const lastWriteText = lastWrite >= 0 ? moment(lastWrite).format(timeShortFormat) : 'Never Written';

            ko.assignToProps(this, {
                dataReady: true,
                state: state,
                writePolicy: writeTo,
                readPolicy: readPolicyText,
                readCount: numeral(readCount).format('0,0'),
                writeCount: numeral(writeCount).format('0,0'),
                lastRead: lastReadText,
                lastWrite: lastWriteText
            });
        }



    }
}

export default {
    viewModel: NamespaceBucketSummaryViewModel,
    template: template
};
