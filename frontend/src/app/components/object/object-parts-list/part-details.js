/* Copyright (C) 2016 NooBaa */

import BlocksTableViewModel from './blocks-table';
import ko from 'knockout';

export default class PartDetailsViewModel {
    blockTables = ko.observableArray();

    constructor(close) {
        this.close = close;
    }

    onState(partDistribution, system) {
        if (!partDistribution) {
            return;
        }

        const tables = partDistribution
            .map((group, i) => {
                const table = this.blockTables.get(i) || new BlocksTableViewModel();
                table.onState(group, system);
                return table;
            });

        this.blockTables(tables, system);
    }

    onX() {
        this.close();
    }
}
