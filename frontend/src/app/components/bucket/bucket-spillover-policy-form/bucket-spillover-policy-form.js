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
import { requestLocation, openEditBucketSpilloverModal } from 'action-creators';

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
    rows = ko.observableArray();

    constructor() {
        super();

        this.observe(
            state$.getMany(
                'location',
                'buckets',
                'hostPools',
                'cloudResources',
                'internalResources'
            ),
            this.onState
        );
    }

    onState([location, buckets, hostPools, cloudResources, internalResources]) {
        const { system, bucket, tab = 'data-policies', section } = location.params;
        this.isExpanded(section === policyName);

        if (!buckets || !buckets[bucket] || !hostPools || !cloudResources || !internalResources) {
            this.isSpilloverDisabled(true);
            this.spilloverState('Disabled');
            this.spilloverUsage('');
            return;
        }

        const toggleSection = section === policyName ? undefined : policyName;
        const toggleUri = realizeUri(
            routes.bucket,
            { system, bucket, tab, section: toggleSection }
        );

        const { spillover } = buckets[bucket];
        const poolList = Object.values(hostPools);
        const cloudList = Object.values(cloudResources);
        const internalList = Object.values(internalResources);

        const resourceList = [
            ...poolList,
            ...cloudList,
            ...internalList
        ];

        const spilloverResources = spillover ? resourceList
            .filter(resource => resource.name === spillover.name) :
            [];

        const rows = spillover ? spilloverResources
            .map((resource, i) => {
                const usage = spillover ? spillover.usage : 0;
                const row = this.rows.get(i) || new SpilloverRowViewModel();
                row.onResource(resource, usage, spillover.type);
                return row;
            }) :
            [];

        this.bucketName = bucket;
        this.toggleUri = toggleUri;
        this.isSpilloverDisabled(!spillover);
        this.rows(rows);

        const internalStorageSize = sumSize(...spilloverResources.map(res => res.storage.total));
        if (spillover) {
            const usage = `${formatSize(spillover.usage)} of ${formatSize(internalStorageSize)} used by this bucket`;
            this.spilloverState('Enabled');
            this.spilloverUsage(usage);
        } else {
            const usage = `${formatSize(internalStorageSize)} potential`;
            this.spilloverState('Disabled');
            this.spilloverUsage(usage);
        }
    }

    onToggleSection() {
        action$.onNext(requestLocation(this.toggleUri));
    }

    onEditSpillover(_, evt) {
        action$.onNext(openEditBucketSpilloverModal(this.bucketName));
        evt.stopPropagation();
    }
}

export default {
    viewModel: BucketSpilloverPolicyFormViewModel,
    template: template
};
