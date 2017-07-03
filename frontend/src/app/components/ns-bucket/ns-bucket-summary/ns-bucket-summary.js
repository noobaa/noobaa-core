/* Copyright (C) 2016 NooBaa */

import template from './ns-bucket-summary.html';
import Observer from 'observer';
import ko from 'knockout';
import { state$ } from 'state';
import { deepFreeze } from 'utils/core-utils';
import moment from 'moment';
import { timeShortFormat } from 'config';

const stateMapping = deepFreeze({
    OPTIMAL: {
        text: 'Healthy',
        icon: {
            name: 'healthy',
            css: 'success'
        }
    }
});

class NsBucketSummaryViewModel extends Observer {
    constructor({ bucket }) {
        super();

        this.stateText = ko.observable();
        this.stateIcon = ko.observable({});
        this.writePolicy = ko.observable();
        this.lastAccess = ko.observable();

        this.observe(
            state$.get('nsBuckets', ko.unwrap(bucket)),
            this.onBucket
        );
    }

    onBucket(bucket) {
        if (!bucket) return;

        const { mode, writePolicy, lastRead, lastWrite } = bucket;
        const { text, icon } = stateMapping[mode];
        const lastAccess = moment(Math.max(lastRead, lastWrite))
            .format(timeShortFormat);

        this.stateText(text);
        this.stateIcon(icon);
        this.writePolicy(writePolicy);
        this.lastAccess(lastAccess);
    }
}

export default {
    viewModel: NsBucketSummaryViewModel,
    template: template
};
