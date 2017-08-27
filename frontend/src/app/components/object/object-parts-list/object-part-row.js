/* Copyright (C) 2016 NooBaa */

import BaseViewModel from 'components/base-view-model';
import ko from 'knockout';
import { formatSize } from 'utils/size-utils';
import { deepFreeze } from 'utils/core-utils';
import BlockRowViewModel from './block-row';

const partStateIcons = deepFreeze({
    available: {
        name: 'healthy',
        css: 'success',
        tooltip: 'Available'
    },
    building:  {
        name: 'working',
        css: 'warning',
        tooltip: 'In process'
    },
    unavailable: {
        name: 'problem',
        css: 'error',
        tooltip: 'Unavailable'
    }
});

const columns = deepFreeze([
    {
        name: 'state',
        type: 'icon'
    },
    {
        name: 'replica'
    },
    {
        name: 'resourceType',
        type: 'icon'
    },
    {
        name: 'replicaLocation',
        type: 'link'
    },
    {
        name: 'node',
        type: 'link'
    }
]);

export default class ObjectPartRowViewModel extends BaseViewModel {
    constructor(part, partNumber, partsCount, poolIconMapping) {
        super();

        const size = formatSize(part.chunk.size);
        const state = part.chunk.adminfo.health;
        const blocks = part.chunk.frags[0].blocks;
        this.columns = columns;

        this.stateIcon = partStateIcons[state];
        this.label = `Part ${partNumber + 1} of ${partsCount} | ${size} | ${blocks.length} replicas`;
        this.blocks = blocks.map(
            (block, i) => new BlockRowViewModel(block, i, blocks.length, poolIconMapping)
        );

        this.isExpended = ko.observable(partsCount === 1);
    }

    toggleExpend() {
        this.isExpended(!this.isExpended());
    }
}
