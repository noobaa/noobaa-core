/* Copyright (C) 2016 NooBaa */

import template from './namespace-bucket-summary.html';
import Observer from 'observer';
import ko from 'knockout';
import { state$ } from 'state';
import moment from 'moment';
import { timeShortFormat } from 'config';
import { getNamespaceBucketStateIcon } from 'utils/bucket-utils';
import { stringifyAmount } from 'utils/string-utils';
import numeral from 'numeral';

class NamespaceBucketSummaryViewModel extends Observer {
    constructor({ bucket }) {
        super();

        this.state = ko.observable();
        this.bucketLoaded = ko.observable();
        this.writePolicy = ko.observable();
        this.readPolicy = ko.observable();
        this.readCount = ko.observable();
        this.writeCount = ko.observable();
        this.lastRead = ko.observable();
        this.lastWrite = ko.observable();

        this.observe(
            state$.get('namespaceBuckets', ko.unwrap(bucket)),
            this.onBucket
        );
    }

    onBucket(bucket) {
        if (!bucket) {
            this.bucketLoaded(false);
            this.state({});
            return;
        }

        const { readFrom, writeTo } = bucket.placement;
        const state = getNamespaceBucketStateIcon(bucket);
        const readPolicyText = readFrom.length === 1 ?
            readFrom[0] :
            stringifyAmount('resource', readFrom.length);

        const { lastRead ,lastWrite, readCount, writeCount } = bucket.io;
        const lastReadText = lastRead >= 0 ? moment(lastRead).format(timeShortFormat) : 'Never Read';
        const lastWriteText = lastWrite >= 0 ? moment(lastWrite).format(timeShortFormat) : 'Never Written';

        this.state(state);
        this.writePolicy(writeTo);
        this.readPolicy(readPolicyText);
        this.readCount(numeral(readCount).format('0,0'));
        this.writeCount(numeral(writeCount).format('0,0'));
        this.lastRead(lastReadText);
        this.lastWrite(lastWriteText);
        this.bucketLoaded(true);
    }
}

export default {
    viewModel: NamespaceBucketSummaryViewModel,
    template: template
};
