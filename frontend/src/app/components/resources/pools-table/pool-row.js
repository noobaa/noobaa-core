/* Copyright (C) 2016 NooBaa */

import deleteBtnTooltipTemplate  from './delete-button-tooltip.html';
import { stringifyAmount } from 'utils/string-utils';
import { realizeUri } from 'utils/browser-utils';
import { getHostsPoolStateIcon } from 'utils/resource-utils';
import { summrizeHostModeCounters } from 'utils/host-utils';
import * as routes from 'routes';
import ko from 'knockout';
import numeral from 'numeral';

export default class PoolRowViewModel {
    constructor({ baseRoute, onSelectForDelete, onDelete }) {
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
            text: 'Delete pool',
            disabled: ko.observable(),
            tooltip: {
                template: deleteBtnTooltipTemplate,
                text: ko.observable()
            },
            id: ko.observable(),
            active: ko.observable(),
            onToggle: onSelectForDelete,
            onDelete: onDelete
        };
    }

    onState(pool, lockingAccounts, system, selectedForDelete) {
        if (!pool) return;
        const { name, connectedBuckets, hostsByMode, storage, undeletable } = pool;

        const stateIcon = getHostsPoolStateIcon(pool);
        this.state({
            ...stateIcon,
            tooltip: {
                text: stateIcon.tooltip,
                align: 'start'
            }
        });

        const uri = realizeUri(this.baseRoute, { pool: name });
        this.name({ text: name, href: uri });

        const bucketCount = connectedBuckets.length;
        this.buckets({
            text: stringifyAmount('bucket',  bucketCount),
            tooltip: bucketCount > 0 ? {
                template: 'linkList',
                text: connectedBuckets.map(bucket => ({
                    text: bucket,
                    href: realizeUri(routes.bucket, { system, bucket })
                }))
            } : null
        });

        const { all, healthy, hasIssues, offline } = summrizeHostModeCounters(hostsByMode);
        this.hostCount(numeral(all).format('0,0'));
        this.healthyCount(numeral(healthy).format('0,0'));
        this.issuesCount(numeral(hasIssues).format('0,0'));
        this.offlineCount(numeral(offline).format('0,0'));

        const { total, used, usedOther, reserved } = storage;
        this.totalCapacity(total);
        this.usedByNoobaaCapacity(used);
        this.usedByOthersCapacity(usedOther);
        this.reservedCapacity(reserved);

        this.deleteButton.id(name);
        this.deleteButton.disabled(Boolean(undeletable));
        this.deleteButton.active(selectedForDelete === name);
        this.deleteButton.tooltip.text({
            reason: undeletable,
            accounts: lockingAccounts
        });
    }
}
