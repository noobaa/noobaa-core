/* Copyright (C) 2016 NooBaa */

import ko from 'knockout';
import { deepFreeze } from 'utils/core-utils';
import { formatSize } from  'utils/size-utils';
import { stringifyAmount } from  'utils/string-utils';
import numeral from 'numeral';

const bucketStateIcons = deepFreeze({
    OPTIMAL: {
        name: 'healthy',
        css: 'success',
        tooltip: 'Healthy',
    }
});

export default class NSBucketRowViewModel {
    constructor() {
        this.state = ko.observable();
        this.name = ko.observable();
        this.objectCount = ko.observable();
        this.readPolicy = ko.observable();
        this.writePolicy = ko.observable();
        this.usage = ko.observable();
    }

    onBucket({ name, mode, storage, objectCount, writePolicy, readPolicy  }) {
        this.name({
            text: name,
            href: {
                route: 'nsBucket',
                params: {
                    bucket: name,
                    tab: null
                }
            }
        });

        this.state(bucketStateIcons[mode]);
        this.objectCount(numeral(objectCount).format('0,0'));
        this.readPolicy({
            text: stringifyAmount('external resource', readPolicy.length, 'No'),
            tooltip: readPolicy
        });
        this.writePolicy(writePolicy);
        this.usage(formatSize(storage.used));
    }
}
