/* Copyright (C) 2016 NooBaa */

import template from './external-resources-table.html';
import Observer from 'observer';
import ExternalResourceRowViewModel from './external-resource-row';
import ko from 'knockout';
import { deepFreeze, createCompareFunc } from 'utils/core-utils';
import { state$ } from 'state';

const columns = deepFreeze([
    {
        name: 'state',
        type: 'icon',
        sortable: true,
        compareKey: res => res.state
    },
    {
        name: 'type',
        type: 'icon',
        sortable: true,
        compareKey: res => res.type
    },
    {
        name: 'name',
        label: 'Resource name',
        sortable: true,
        compareKey: res => res.name
    },
    {
        name: 'usage',
        label: 'Data Written',
        sortable: true,
        compareKey: res => res.storage.used
    }
]);

class ExternalResourceTableViewModel extends Observer {
    constructor() {
        super();

        this.columns = columns;
        this.sorting = ko.observable();
        this.rows = ko.observableArray();

        this.observe(
            state$.getMany('externalResources', ['location', 'query']),
            this.onResources
        );
    }

    onResources([ resources, query ]) {
        const { sortBy = 'name', order = 1 } = query;
        this.sorting({ sortBy, order });

        const { compareKey } = columns.find(col => col.name == sortBy);
        const compareOp = createCompareFunc(compareKey, order);
        const orderedResources = Object.values(resources).sort(compareOp);

        this.rows(orderedResources.map((res, i) => {
            const row = this.rows()[i] || new ExternalResourceRowViewModel();
            row.onResource(res);
            return row;
        }));
    }
}

export default {
    viewModel: ExternalResourceTableViewModel,
    template: template
};
