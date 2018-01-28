/* Copyright (C) 2016 NooBaa */

import BlocksTableViewModel from './blocks-table';
import ko from 'knockout';

export default class PartDetailsViewModel {
    fade = ko.observable();
    partSeq = ko.observable();
    blockTables = ko.observableArray();

    constructor(close) {
        this.close = close;
    }

    onState(partSeq, partDistribution, system) {
        const tables = partDistribution
            .map((group, i) => {
                const table = this.blockTables.get(i) || new BlocksTableViewModel();
                table.onState(group, system);
                return table;
            });

        if (this.partSeq() && partSeq + 1 !== this.partSeq()) {
            this.fade(true);
        }

        this.partSeq(partSeq + 1);
        this.blockTables(tables, system);
    }

    onAnimationEnd() {
        this.fade(false);
    }

    onX() {
        this.close();
    }
}
