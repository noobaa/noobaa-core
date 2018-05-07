/* Copyright (C) 2016 NooBaa */

import template from './server-table.html';
import Observer from 'observer';
import ko from 'knockout';
import ServerRowViewModel from './server-row';
import { createCompareFunc, deepFreeze, throttle } from 'utils/core-utils';
import { getServerDisplayName } from 'utils/cluster-utils';
import { toBytes } from 'utils/size-utils';
import { realizeUri } from 'utils/browser-utils';
import { inputThrottle } from 'config';
import { action$, state$ } from 'state';
import * as routes from 'routes';
import { getMany } from 'rx-extensions';
import { openAttachServerModal, requestLocation } from 'action-creators';

const columns = deepFreeze([
    {
        name: 'state',
        type: 'icon',
        sortable: true,
        compareKey: server => server.mode
    },
    {
        name: 'name',
        label: 'server name',
        type: 'newLink',
        sortable: true,
        compareKey: server => getServerDisplayName(server)
    },
    {
        name: 'address',
        label: 'IP Address',
        sortable: true,
        compareKey: server => (server.addresses || [])[0]
    },
    {
        name: 'diskUsage',
        sortable: true,
        compareKey: server => 1 - toBytes(server.storage.free) / toBytes(server.storage.total)
    },
    {
        name: 'memoryUsage',
        sortable: true,
        compareKey: server => server.memory.used / server.memory.total
    },
    {
        name: 'cpuUsage',
        label: 'CPU usage',
        sortable: true,
        compareKey: server => server.cpus.usage
    },
    {
        name: 'location',
        label: 'Location Tag',
        sortable: true,
        compareKey: server => server.location
    },
    {
        name: 'version',
        sortable: true,
        compareKey: server => server.version
    }
]);

const noNtpTooltip = deepFreeze({
    align: 'end',
    text: 'NTP must be configured before attaching a new server'
});

function _matchFilter(server, filter = '') {
    const { addresses, locationTag } = server;
    return [`${getServerDisplayName(server)}`, addresses[0], locationTag].some(
        key => key.toLowerCase().includes(filter.toLowerCase())
    );
}

class ServerTableViewModel extends Observer {
    pathname = '';
    columns = columns;
    canAttachServer = ko.observable();
    attachServerTooltip = ko.observable();
    filter = ko.observable();
    sorting = ko.observable();
    rows = ko.observableArray();
    isStateLoaded = ko.observable();
    onFilterThrottled = throttle(this.onFilter, inputThrottle, this);

    constructor() {
        super();

        this.observe(
            state$.pipe(
                getMany(
                    'topology',
                    'system',
                    'location'
                )
            ),
            this.onState
        );
    }

    onState([topology, system, location]) {
        if (!topology) {
            this.isStateLoaded(false);
            return;
        }

        const { params, query, pathname } = location;
        const { filter = '', sortBy = 'name' } = query;
        const order = Number(location.query.order) || 1;
        const { compareKey } = columns.find(column => column.name === sortBy);
        const serverList = Object.values(topology.servers);
        const rowParams = {
            baseRoute: realizeUri(routes.server, { system: params.system }, {}, true)
        };
        const master = serverList.find(server => server.isMaster);
        const canAttachServer = Boolean(master.ntp);
        const attachServerTooltip = canAttachServer ? noNtpTooltip : '';

        const filteredRows = serverList
            .filter(server => _matchFilter(server, filter));

        const rows = filteredRows
            .sort(createCompareFunc(compareKey, order))
            .map((server, i) => {
                const row = this.rows.get(i) || new ServerRowViewModel(rowParams);
                row.onState(server, system.version, topology.serverMinRequirements);
                return row;
            });

        this.pathname = pathname;
        this.filter(filter);
        this.sorting({ sortBy, order });
        this.rows(rows);
        this.canAttachServer(canAttachServer);
        this.attachServerTooltip(attachServerTooltip);
        this.isStateLoaded(true);
    }

    onFilter(filter) {
        this._query({ filter });
    }

    onSort(sorting) {
        this._query({ sorting });
    }

    _query(params) {
        const {
            filter = this.filter(),
            sorting = this.sorting()
        } = params;

        const { sortBy, order } = sorting;
        const query = {
            filter: filter || undefined,
            sortBy: sortBy,
            order: order
        };

        action$.next(requestLocation(
            realizeUri(this.pathname, null, query)
        ));
    }

    onAttachServerToCluster() {
        action$.next(openAttachServerModal());
    }
}

export default {
    viewModel: ServerTableViewModel,
    template: template
};
