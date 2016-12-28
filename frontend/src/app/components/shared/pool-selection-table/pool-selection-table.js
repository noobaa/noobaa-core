import template from './pool-selection-table.html';
import BaseViewModel from 'base-view-model';
import PoolRowViewModel from './pool-row';
import ko from 'knockout';
import { deepFreeze } from 'utils/all';

const columns = deepFreeze([
    {
        name: 'select',
        label: '',
        type: 'checkbox'
    },
    {
        name: 'state',
        type: 'icon'
    },
    {
        name: 'type',
        type: 'icon'
    },
    {
        name: 'name'
    },
    {
        name: 'onlineNodes'
    },
    {
        name: 'freeSpace',
        label: 'Available Capacity'
    }
]);

class PoolSelectionTableViewModel extends BaseViewModel {
    constructor({
        caption = 'Select pools',
        pools = [],
        selectedPools = ko.observableArray()
    }) {
        super();

        this.caption = caption;
        this.columns = columns;
        this.pools = pools;
        this.selectedPools = selectedPools;

        this.poolNames = ko.pureComputed(
            () => (ko.unwrap(pools) || []).map(
                pool => pool.name
            )
        );
    }

    createRow(pool) {
        return new PoolRowViewModel(pool, this.selectedPools);
    }

    selectListedPools() {
        let names = this.poolNames().filter(
            name => !this.selectedPools().includes(name)
        );

        this.selectedPools(
            this.selectedPools().concat(names)
        );
    }

    clearListedPools() {
        this.selectedPools.removeAll(
            this.poolNames()
        );
    }
}

export default {
    viewModel: PoolSelectionTableViewModel,
    template: template
};
