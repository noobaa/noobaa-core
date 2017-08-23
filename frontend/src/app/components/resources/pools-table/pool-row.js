/* Copyright (C) 2016 NooBaa */

import { deepFreeze } from 'utils/core-utils';
import { stringifyAmount } from 'utils/string-utils';
import { realizeUri } from 'utils/browser-utils';
import { getHostsPoolStateIcon } from 'utils/resource-utils';
import { summrizeHostModeCounters } from 'utils/host-utils';
import ko from 'knockout';
import numeral from 'numeral';

const undeletableReasons = deepFreeze({
    SYSTEM_ENTITY: 'Cannot delete system defined default pool',
    NOT_EMPTY: 'Cannot delete a pool which contains nodes',
    IN_USE: 'Cannot delete a pool that is assigned to a bucket policy',
    DEFAULT_RESOURCE: 'Cannot delete a pool that is used as a default resource by an account'
});

export default class PoolRowViewModel {
    constructor({ baseRoute, deleteGroup, onDelete }) {

        this.baseRoute = baseRoute;
        this.state = ko.observable();
        this.name = ko.observable();
        this.buckets = ko.observable();
        this.hostCount = ko.observable();
        this.healthyCount = ko.observable();
        this.issuesCount = ko.observable();
        this.offlineCount = ko.observable();
        this.totalCapacity = ko.observable();
        this.usedByNoobaaCapacity = ko.observable();
        this.usedByOthersCapacity = ko.observable();
        this.reservedCapacity = ko.observable();

        this.capacity = {
            total: this.totalCapacity,
            used: [
                {
                    label: 'Used (Noobaa)',
                    value: this.usedByNoobaaCapacity
                },
                {
                    label: 'Used (other)',
                    value: this.usedByOthersCapacity
                },
                {
                    label: 'Reserved',
                    value: this.reservedCapacity
                }
            ]
        };

        this.deleteButton = {
            subject: 'pool',
            undeletable: ko.observable(),
            tooltip: ko.observable(),
            id: ko.observable(),
            group: deleteGroup,
            onDelete: onDelete
        };
    }

    onPool(pool) {
        if (!pool) return;
        const { name, connectedBuckets, hostsByMode, storage, undeletable } = pool;

        // TODO: calc pool icon based on mode.
        this.state(getHostsPoolStateIcon(pool));

        const uri = realizeUri(this.baseRoute, { pool: name });
        this.name({ text: name, href: uri });

        const bucketCount = connectedBuckets.length;
        this.buckets({
            text: stringifyAmount('bucket',  bucketCount),
            tooltip: bucketCount ? connectedBuckets : null
        });

        const { all, healthy, hasIssues, offline } = summrizeHostModeCounters(hostsByMode);
        this.hostCount(numeral(all).format('0,0'));
        this.healthyCount(numeral(healthy).format('0,0'));
        this.issuesCount(numeral(hasIssues).format('0,0'));
        this.offlineCount(numeral(offline).format('0,0'));

        const { total, used, used_other, reserved } = storage;
        this.totalCapacity(total);
        this.usedByNoobaaCapacity(used);
        this.usedByOthersCapacity(used_other);
        this.reservedCapacity(reserved);

        this.deleteButton.id(name);
        this.deleteButton.undeletable(Boolean(undeletable));
        this.deleteButton.tooltip(undeletableReasons[undeletable]);
    }
}
