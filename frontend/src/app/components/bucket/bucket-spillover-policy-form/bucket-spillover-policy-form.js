/* Copyright (C) 2016 NooBaa */

import template from './bucket-spillover-policy-form.html';
import Observer from 'observer';
import SpilloverRowViewModel from './spillover-row';
import { state$, action$ } from 'state';
import { realizeUri } from 'utils/browser-utils';
import { deepFreeze } from 'utils/core-utils';
import { sumSize, formatSize } from 'utils/size-utils';
import ko from 'knockout';
import * as routes from 'routes';
import { requestLocation, toggleBucketSpillover } from 'action-creators';

const policyName = 'spillover';

const columns = deepFreeze([
    {
        name: 'state',
        type: 'icon'
    },
    {
        name: 'type',
        type: 'icon'
    },
    {
        name: 'resourceName'
    },
    {
        name: 'bucketUsage',
        label: 'Usage by This Bucket',
        type: 'capacity'
    }
]);

class BucketSpilloverPolicyFormViewModel extends Observer {
    columns = columns;
    isExpanded = ko.observable();
    toggleUri = '';
    spilloverState = ko.observable();
    spilloverUsage = ko.observable();
    isSpilloverDisabled = ko.observable();
    toggleText = ko.observable();
    rows = ko.observableArray();

    constructor() {
        super();

        this.observe(
            state$.getMany(
                'location',
                'buckets',
                'internalResources'
            ),
            this.onState
        );
    }

    onState([location, buckets, internalResources]) {
        const { system, bucket, tab = 'data-policies', section } = location.params;
        this.isExpanded(section === policyName);

        if (!buckets || !buckets[bucket] || !internalResources) {
            this.isSpilloverDisabled(true);
            this.spilloverState('Disabled');
            this.spilloverUsage('');
            this.toggleText('Enable Spillover');
            return;
        }

        const toggleSection = section === policyName ? undefined : policyName;
        const toggleUri = realizeUri(
            routes.bucket,
            { system, bucket, tab, section: toggleSection }
        );

        const { spillover } = buckets[bucket];
        const resourceList = Object.values(internalResources);
        const rows = resourceList
            .map((resource, i) => {
                const usage = spillover ? spillover.usage : 0;
                const row = this.rows.get(i) || new SpilloverRowViewModel();
                row.onResource(resource, usage);
                return row;
            });

        this.bucketName = bucket;
        this.toggleUri = toggleUri;
        this.isSpilloverDisabled(!spillover);
        this.rows(rows);

        const internalStorageSize = sumSize(...resourceList.map(res => res.storage.total));
        if (spillover) {
            const usage = `${formatSize(spillover.usage)} of ${formatSize(internalStorageSize)} used by this bucket`;
            this.spilloverState('Enabled');
            this.spilloverUsage(usage);
            this.toggleText('Disable Spillover');
        } else {
            const usage = `${formatSize(internalStorageSize)} potential`;
            this.spilloverState('Disabled');
            this.spilloverUsage(usage);
            this.toggleText('Enable Spillover');
        }
    }

    onToggleSection() {
        action$.onNext(requestLocation(this.toggleUri));
    }

    onToggleSpillover(_, evt) {
        const { bucketName, isSpilloverDisabled } = this;
        action$.onNext(toggleBucketSpillover(bucketName, isSpilloverDisabled()));
        evt.stopPropagation();
    }
}

export default {
    viewModel: BucketSpilloverPolicyFormViewModel,
    template: template
};
