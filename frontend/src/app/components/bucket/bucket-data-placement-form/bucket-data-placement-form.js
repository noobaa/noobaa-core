/* Copyright (C) 2016 NooBaa */
import template from './bucket-data-placement-form.html';
import Observer from 'observer';
import PlacementRowViewModel from './placement-row';
import SpilloverRowViewModel from './spillover-row';
import { state$, action$ } from 'state';
import { getPlacementTypeDisplayName } from 'utils/bucket-utils';
import { deepFreeze } from 'utils/core-utils';
import ko from 'knockout';
import {
    openEditBucketQuotaModal,
    openEditBucketPlacementModal,
    toggleBucketSpillover
} from 'action-creators';

const placementColumns = deepFreeze([
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

const spilloverColumns = deepFreeze([
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


class BucketDataPlacementFormViewModel extends Observer {
    constructor({ bucketName }) {
        super();

        this.infoLoaded = ko.observable();
        this.bucketName = ko.unwrap(bucketName);
        this.placementColumns = placementColumns;
        this.placementType = ko.observable();
        this.hostPoolCount = ko.observable();
        this.cloudResourceCount = ko.observable();
        this.placementRows = ko.observableArray();
        this.spilloverEnabled = false;
        this.spilloverColumns = spilloverColumns;
        this.spilloverRows = ko.observableArray();
        this.spilloverToggleText = ko.observable();

        this.observe(
            state$.getMany(
                ['buckets', this.bucketName],
                'hostPools',
                'cloudResources',
                'internalResources',
                ['location', 'params', 'system']
            ),
            this.onBucket
        );
    }

    onBucket([ bucket, hostPools, cloudResources, internalResources, system ]) {
        if (!bucket || !hostPools || !cloudResources || !internalResources) {
            this.infoLoaded(false);
            this.placementType('');
            this.hostPoolCount('');
            this.cloudResourceCount('');
            this.spilloverToggleText('Enable Spillover');
            return;
        }

        const { placement, spillover } = bucket;
        const counters = placement.resources
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

        const placementRows = placement.resources
            .map((item, i) => {
                const { type, name, usage } = item;
                const resource = resources[type][name];
                const row = this.placementRows.get(i) || new PlacementRowViewModel();
                row.onResource(type, resource, usage, system);
                return row;
            });


        const spilloverRows = Object.values(internalResources)
            .map((resource, i) => {
                const usage = spillover ? spillover.usage : 0;
                const row = this.spilloverRows.get(i) || new SpilloverRowViewModel();
                row.onResource(resource, usage, !spillover);
                return row;
            });

        this.placementType(getPlacementTypeDisplayName(placement.policyType));
        this.hostPoolCount(counters.HOSTS);
        this.cloudResourceCount(counters.CLOUD);
        this.placementRows(placementRows);
        this.spilloverRows(spilloverRows);
        this.spilloverToggleText(`${spillover ? 'Disable' : 'Enable'} Spillover`);
        this.spilloverEnabled = Boolean(spillover);
        this.infoLoaded(true);
    }

    onEditBucketQuota() {
        action$.onNext(
            openEditBucketQuotaModal(this.bucketName)
        );
    }

    onEditDataPlacement() {
        action$.onNext(
            openEditBucketPlacementModal(this.bucketName)
        );
    }

    onToggleSpillover() {
        action$.onNext(
            toggleBucketSpillover(this.bucketName, !this.spilloverEnabled)
        );
    }
}

export default {
    viewModel: BucketDataPlacementFormViewModel,
    template: template
};
