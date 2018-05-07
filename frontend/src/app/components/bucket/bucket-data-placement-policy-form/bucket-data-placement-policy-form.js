/* Copyright (C) 2016 NooBaa */

import template from './bucket-data-placement-policy-form.html';
import Observer from 'observer';
import PlacementRowViewModel from './placement-row';
import { state$, action$ } from 'state';
import { deepFreeze, flatMap } from 'utils/core-utils';
import { realizeUri } from 'utils/browser-utils';
import { getPlacementTypeDisplayName } from 'utils/bucket-utils';
import ko from 'knockout';
import * as routes from 'routes';
import { requestLocation, openEditBucketPlacementModal } from 'action-creators';
import { getMany } from 'rx-extensions';

const policyName = 'data-placement';

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
        name: 'resourceName',
        type: 'newLink'
    },
    {
        name: 'onlineHostCount',
        label: 'online nodes in pool'
    },
    {
        name: 'bucketUsage',
        label: 'Raw Usage by This Bucket',
        type: 'capacity'
    }
]);

class BucketDataPlacementPolicyFormViewModel extends Observer {
    columns = columns;
    isExpanded = ko.observable();
    toggleUri = '';
    placementType = ko.observable();
    hostPoolCount = ko.observable();
    cloudResourceCount = ko.observable();
    rows = ko.observableArray();

    constructor() {
        super();

        this.observe(
            state$.pipe(
                getMany(
                    'location',
                    'buckets',
                    'hostPools',
                    'cloudResources'
                )
            ),
            this.onState
        );
    }

    onState([location, buckets, hostPools, cloudResources]) {
        const { system, section, tab = 'data-policies', bucket } = location.params;
        this.isExpanded(section === policyName);

        if (!buckets || !buckets[bucket] || !hostPools || !cloudResources) {
            this.placementType('');
            this.hostPoolCount('');
            this.cloudResourceCount('');
            return;
        }

        const toggleSection = section === policyName ? undefined : policyName;
        const toggleUri = realizeUri(
            routes.bucket,
            { system, bucket, tab, section: toggleSection }
        );

        const { placement } = buckets[bucket];
        const resourceNames = flatMap(placement.mirrorSets, ms => ms.resources);
        const counters = resourceNames
            .reduce(
                (counters, res) => {
                    ++counters[res.type];
                    return counters;
                },
                { HOSTS: 0, CLOUD: 0 }
            );

        const resources = {
            HOSTS: hostPools,
            CLOUD: cloudResources
        };

        const rows = resourceNames
            .map((item, i) => {
                const { type, name, usage } = item;
                const resource = resources[type][name];
                const row = this.rows.get(i) || new PlacementRowViewModel();
                row.onResource(type, resource, usage, system);
                return row;
            });

        this.bucketName = bucket;
        this.toggleUri = toggleUri;
        this.placementType(getPlacementTypeDisplayName(placement.policyType));
        this.hostPoolCount(counters.HOSTS);
        this.cloudResourceCount(counters.CLOUD);
        this.rows(rows);
    }

    onToggleSection() {
        action$.next(requestLocation(this.toggleUri));
    }

    onEditDataPlacement(_, evt) {
        action$.next(openEditBucketPlacementModal(this.bucketName));
        evt.stopPropagation();
    }
}

export default {
    viewModel: BucketDataPlacementPolicyFormViewModel,
    template: template
};
