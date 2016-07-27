import template from './pool-selection-table.html';
import Disposable from 'disposable';
import PoolRowViewModel from './pool-row';
import ko from 'knockout';
import { deepFreeze } from 'utils';

const columns = deepFreeze([
    {
        name: 'select',
        label: '',
        cellTemplate: 'checkbox'
    },
    {
        name: 'state',
        cellTemplate: 'icon'
    },
    'name',
    'onlineCount',
    'freeSpace'
]);

class PoolSelectionTableViewModel extends Disposable{
    constructor({
        pools = [],
        selectedPools = ko.observableArray()
    }) {
        super();

        this.columns = columns;
        this.pools = pools;
        this.selectedPools = selectedPools;
    }

    createRow(pool) {
        return new PoolRowViewModel(pool, this.selectedPools);
    }
}

export default {
    viewModel: PoolSelectionTableViewModel,
    template: template
};
