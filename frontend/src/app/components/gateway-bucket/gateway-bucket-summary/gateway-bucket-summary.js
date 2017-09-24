/* Copyright (C) 2016 NooBaa */

import template from './gateway-bucket-summary.html';
import Observer from 'observer';
import ko from 'knockout';
import { state$ } from 'state';
import moment from 'moment';
import { timeShortFormat } from 'config';
import { getGatewayBucketStateIcon } from 'utils/bucket-utils';
import { stringifyAmount } from 'utils/string-utils';

class GatewayBucketSummaryViewModel extends Observer {
    constructor({ bucket }) {
        super();

        this.state = ko.observable();
        this.bucketLoaded = ko.observable();
        this.writePolicy = ko.observable();
        this.readPolicy = ko.observable();
        this.lastRead = ko.observable();
        this.lastWrite = ko.observable();

        this.observe(
            state$.get('gatewayBuckets', ko.unwrap(bucket)),
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
        const state = getGatewayBucketStateIcon(bucket);
        const readPolicyText = readFrom.length === 1 ?
            readFrom[0] :
            stringifyAmount('namespace resource', readFrom.length);

        const { lastRead ,lastWrite } = bucket.io;
        const lastReadText = lastRead >= 0 ? moment(lastRead).format(timeShortFormat) : 'Never Read';
        const lastWriteText = lastRead >= 0 ? moment(lastWrite).format(timeShortFormat) : 'Never Written';

        this.state(state);
        this.writePolicy(writeTo);
        this.readPolicy(readPolicyText);
        this.lastRead(lastReadText);
        this.lastWrite(lastWriteText);
        this.bucketLoaded(true);
    }
}

export default {
    viewModel: GatewayBucketSummaryViewModel,
    template: template
};
