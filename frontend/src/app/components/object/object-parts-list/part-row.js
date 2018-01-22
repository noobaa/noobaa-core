/* Copyright (C) 2016 NooBaa */

import ko from 'knockout';
import numeral from 'numeral';
import { formatSize } from 'utils/size-utils';
import { deepFreeze, sumBy, assignWith } from 'utils/core-utils';
import { formatBlockDistribution } from 'utils/object-utils';

const partModeToState = deepFreeze({
    UNAVAILABLE: {
        name: 'problem',
        css: 'error',
        tooltip: 'Unavailable'
    },
    BUILDING: {
        name: 'working',
        css: 'warning',
        tooltip:'Rebuilding'
    },
    AVAILABLE: {
        name: 'healthy',
        css: 'success',
        tooltip: 'Healthy'
    }
});

function _getDistributionCounters(distribution) {
    const counters = {
        replicas: 0,
        dataFrags: 0,
        parityFrags: 0,
        toBeRemoved: 0
    };

    for (const group of distribution) {
        const { storagePolicy } = group;
        if (group.type === 'TO_BE_REMOVED') {
            counters.toBeRemoved +=  sumBy(Object.values(storagePolicy));
        } else {
            assignWith(counters, storagePolicy, (a, b) => a + b);
        }
    }

    return counters;
}

export default class PartRowViewModel {
    css = ko.observable();
    state = ko.observable();
    summary = ko.observable();
    isSelected = ko.observable();
    select = null;

    constructor(onSelect) {
        this.select = onSelect;
    }

    onState(part, distribution, isSelected) {
        const seq = numeral(part.seq + 1).format(',');
        const size = formatSize(part.size);
        const counters = _getDistributionCounters(distribution);
        const summary = `Part ${seq} | ${size} | ${formatBlockDistribution(counters, ', ')}`;

        this.isSelected(isSelected);
        this.summary(summary);
        this.state(partModeToState[part.mode]);
    }

    onMoreDetails() {
        this.select();
    }
}
