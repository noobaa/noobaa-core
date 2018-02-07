/* Copyright (C) 2016 NooBaa */

import template from './bucket-spillover-policy-form.html';
import Observer from 'observer';
import SpilloverRowViewModel from './spillover-row';
import { state$, action$ } from 'state';
import { realizeUri } from 'utils/browser-utils';
import { deepFreeze, ensureArray } from 'utils/core-utils';
import { formatSize } from 'utils/size-utils';
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
        const spilloverResource =
            (!spillover && []) ||
            Object.values(internalResources).find(resource => resource.name === spillover.name) ||
            Object.values(cloudResources).find(resource => resource.name === spillover.name) ||
            Object.values(hostPools).find(resource => resource.name === spillover.name);

        const rows = ensureArray(spilloverResource)
            .map((resource, i) => {
                const usage = spillover ? spillover.usage : 0;
                const row = this.rows.get(i) || new SpilloverRowViewModel();
                row.onResource(spillover.type, resource, usage);
                return row;
            });

        this.bucketName = bucket;
        this.toggleUri = toggleUri;
        this.rows(rows);

        if (spillover) {
            const formattedUsage = formatSize(spillover.usage);
            const formattedTotal = formatSize(spilloverResource.storage.total);
            const usage = `${formattedUsage} of ${formattedTotal} used by this bucket`;
            this.spilloverState('Enabled');
            this.spilloverUsage(usage);
        } else {
            this.spilloverState('Disabled');
            this.spilloverUsage('');
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
