/* Copyright (C) 2016 NooBaa */

import template from './endpoint-groups-table.html';
import ConnectableViewModel from 'components/connectable';
import ko from 'knockout';
import numeral from 'numeral';
import moment from 'moment';
import { createCompareFunc } from 'utils/core-utils';
import { realizeUri } from 'utils/browser-utils';
import { paginationPageSize } from 'config';
import {
    requestLocation,
    openDeployRemoteEndpointGroupModal
} from 'action-creators';


const columns = Object.freeze([
    {
        name: 'name',
        type: 'nameAndLocality',
        label: 'Endpoint Group',
        sortable: true,
        compareKey: group => group.name
    },
    {
        name: 'count',
        sortable: true,
        compareKey: group => group.endpointCount
    },
    {
        name: 'range',
        label: 'Endpoint Range',
        sortable: false
    },
    {
        name: 'region',
        sortable: true,
        compareKey: () => ''
    },
    {
        name: 'cpuUsage',
        label: 'CPU %',
        sortable: true,
        compareKey: group => group.cpuUsage
    },
    {
        name: 'memoryUsage',
        label: 'Memory %',
        sortable: true,
        compareKey: group => group.memoryUsage
    }
]);

class EndpointGroupRowViewModel {
    name = ko.observable();
    count = ko.observable();
    range = ko.observable();
    region = ko.observable();
    cpuUsage = ko.observable();
    memoryUsage = ko.observable();
}

class EndpointsTableViewModel extends ConnectableViewModel {
    dataReady = ko.observable();
    columns = columns;
    pathname = '';
    lastUpdate = ko.observable();
    sorting = ko.observable({});
    groupCount = ko.observable();
    pageSize = ko.observable();
    page = ko.observable();
    rows = ko.observableArray()
        .ofType(EndpointGroupRowViewModel);

    selectState(state) {
        return [
            state.location,
            state.endpointGroups
        ];
    }

    mapStateToProps(location, groups) {
        if (!groups) {
            ko.assignToProps(this, {
                dataReady: false
            });

        } else {
            const { pathname, query } = location;
            const { sortBy = 'name' } = query;
            const order = Number(query.order) || 1;
            const page = Number(query.page) || 0;
            const pageSize = Number(query.pageSize) || paginationPageSize.default;
            const { compareKey } = columns.find(column => column.name === sortBy);
            const groupList = Object.values(groups).sort(createCompareFunc(compareKey, order));
            const lastUpdate = Math.min(...groupList.map(group => group.lastReportTime));

            ko.assignToProps(this, {
                dataReady: true,
                pathname,
                lastUpdate: lastUpdate > 0 ? moment(lastUpdate).fromNow() : null,
                sorting: { sortBy, order },
                pageSize,
                page,
                groupCount: groupList.length,
                rows: groupList.map(group => {
                    const { min, max } = group.endpointRange;
                    return {
                        name: {
                            name: group.name,
                            localGroup: !group.isRemote
                        },
                        count: group.endpointCount,
                        range: `${min} - ${max}`,
                        region: '(Not Set)',
                        cpuUsage: numeral(group.cpuUsage).format('%'),
                        memoryUsage: numeral(group.memoryUsage).format('%')
                    };
                })
            });
        }
    }

    onDeployRemoteEndpointGroup() {
        this.dispatch(openDeployRemoteEndpointGroupModal());
    }

    onSort(sorting) {
        this._query({
            sortBy: sorting.sortBy,
            order: sorting.order,
            page: 0
        });
    }

    onPageSize(pageSize) {
        this._query({
            pageSize,
            page: 0
        });
    }

    onPage(page) {
        this._query({
            page
        });
    }

    _query(query) {
        const {
            // filter = this.filter(),
            sortBy = this.sorting().sortBy,
            order = this.sorting().order,
            page = this.page(),
            pageSize = this.pageSize()
        } = query;

        const queryUrl = realizeUri(this.pathname, null, {
            // filter: filter || undefined,
            sortBy,
            order,
            page,
            pageSize
        });

        this.dispatch(requestLocation(queryUrl));
    }
}

export default {
    viewModel: EndpointsTableViewModel,
    template: template
};
