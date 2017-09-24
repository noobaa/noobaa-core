/* Copyright (C) 2016 NooBaa */

import template from './gateway-bucket-data-placement-form.html';
import Observer from 'observer';
import ResourceRowViewModel from './resource-row';
import { deepFreeze, pick } from 'utils/core-utils';
import ko from 'knockout';
import { state$, action$ } from 'state';
import { openEditGatewayBucketDataPlacementModal } from 'action-creators';

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
        name: 'name',
        type: 'nameAndRule',
        label: 'External Resource Name'
    },
    {
        name: 'target',
        label: 'Target Name'
    }
]);

class GatewayBucketDataPlacementFormViewModel extends Observer {
    constructor({ bucket }) {
        super();

        this.columns = columns;
        this.bucketName = ko.unwrap(bucket);
        this.rows = ko.observableArray();
        this.stateLoaded = ko.observable();

        this.observe(
            state$.getMany(
                ['gatewayBuckets', this.bucketName],
                'namespaceResources'
            ),
            this.onBucket
        );
    }

    onBucket([ bucket, resources ]) {
        if (!bucket || !resources) {
            this.stateLoaded(false);
            return;
        }

        const { readFrom, writeTo } = bucket.placement;
        const rows = Object.values(pick(resources, readFrom))
            .map((resource, i) => {
                const row = this.rows.get(i) || new ResourceRowViewModel();
                row.onResource(resource, resource.name === writeTo);
                return row;
            });

        this.rows(rows);
        this.stateLoaded(true);
    }

    onEditPlacement() {
        const action = openEditGatewayBucketDataPlacementModal(this.bucketName);
        action$.onNext(action);
    }
}

export default {
    viewModel: GatewayBucketDataPlacementFormViewModel,
    template: template
};
