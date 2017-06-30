/* Copyright (C) 2016 NooBaa */

import template from './bucket-data-placement-table.html';
import PlacementRowViewModel from './placement-row';
import ko from 'knockout';
import BaseViewModel from 'components/base-view-model';
import { deepFreeze } from 'utils/core-utils';

const placementTableColumns = deepFreeze([
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
        type: 'custom-link'
    },
    {
        name: 'onlineNodeCount',
        label: 'online nodes in pool'
    },
    {
        name: 'capacity',
        label: 'Resource Capacity',
        type: 'capacity'
    }
]);

class BucketDataPlacementTableViewModel extends BaseViewModel {
    constructor({ nodePools }) {
        super();

        this.placementTableColumns = placementTableColumns;
        this.nodePools =  ko.pureComputed(
            () => ko.unwrap(nodePools)
        );
    }

    createPlacementRow(pool) {
        return new PlacementRowViewModel(pool);
    }
}

export default {
    viewModel: BucketDataPlacementTableViewModel,
    template: template
};
