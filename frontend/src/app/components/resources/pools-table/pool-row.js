/* Copyright (C) 2016 NooBaa */

import { deepFreeze } from 'utils/core-utils';
import { stringifyAmount } from 'utils/string-utils';
import { realizeUri } from 'utils/browser-utils';
import ko from 'knockout';
import numeral from 'numeral';

const undeletableReasons = deepFreeze({
    SYSTEM_ENTITY: 'Cannot delete system defined default pool',
    NOT_EMPTY: 'Cannot delete a pool which contains nodes',
    IN_USE: 'Cannot delete a pool that is assigned to a bucket policy',
    DEFAULT_RESOURCE: 'Cannot delete a pool that is used as a default resource by an account'
});

export default class PoolRowViewModel {
    constructor({ baseRoute, onDelete }) {

        this.baseRoute = baseRoute;
        this.state = ko.observable();
        this.name = ko.observable();
        this.buckets = ko.observable();
        this.hostCount = ko.observable();
        this.healthyCount = ko.observable();
        this.issuesCount = ko.observable();
        this.offlineCount = ko.observable();

        this.capacity = {
            total: ko.observable(),
            used: [
                {
                    label: 'Used (Noobaa)',
                    value: ko.observable()
                },
                {
                    label: 'Used (other)',
                    value: ko.observable()
                },
                {
                    label: 'Reserved',
                    value: ko.observable()
                }
            ]
        };

        this.deleteButton = {
            subject: 'pool',
            undeletable: ko.observable(),
            tooltip: ko.observable(),
            onDelete: () => onDelete(this.name())
        };
    }

    onPool(pool) {
        if (!pool) return;
        const { name, connectedBuckets, hostCount, hostsByMode,
            storage, undeletable } = pool;

        // TODO: calc pool icon based on mode.
        this.state({
            tooltip: 'Healthy',
            css: 'success',
            name: 'healthy'
        });

        const uri = realizeUri(this.baseRoute, { pool: name });
        this.name({ text: name, href: uri });

        const bucketCount = connectedBuckets.length;
        this.buckets({
            text: stringifyAmount('bucket',  bucketCount),
            tooltip: bucketCount ? connectedBuckets : null
        });

        const { OPTIMAL = 0, OFFLINE = 0 } = hostsByMode;
        this.hostCount(numeral(hostCount).format('0,0'));
        this.healthyCount(numeral(OPTIMAL).format('0,0'));
        this.offlineCount(numeral(OFFLINE).format('0,0'));
        this.issuesCount(numeral(hostCount - OPTIMAL - OFFLINE).format('0,0'));

        const { total, used, used_other, reserved } = storage;
        this.capacity.total(total);
        this.capacity.used[0].value(used);
        this.capacity.used[1].value(used_other);
        this.capacity.used[2].value(reserved);

        this.deleteButton.undeletable(Boolean(undeletable));
        this.deleteButton.tooltip(undeletableReasons[undeletable]);
    }
}
