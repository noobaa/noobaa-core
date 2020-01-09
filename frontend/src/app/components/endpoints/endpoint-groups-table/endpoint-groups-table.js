/* Copyright (C) 2016 NooBaa */

import template from './endpoint-groups-table.html';
import ConnectableViewModel from 'components/connectable';
import ko from 'knockout';
import numeral from 'numeral';
import moment from 'moment';
import { createCompareFunc } from 'utils/core-utils';
import { realizeUri } from 'utils/browser-utils';
import { requestLocation } from 'action-creators';
import { paginationPageSize } from 'config';


const columns = Object.freeze([
    {
        name: 'name',
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
            const lastUpdate = Math.min(...groupList.map(group => group.lastUpdate));

            ko.assignToProps(this, {
                dataReady: true,
                pathname,
                lastUpdate: moment(lastUpdate).fromNow(),
                sorting: { sortBy, order },
                pageSize,
                page,
                groupCount: groupList.length,
                rows: groupList.map(group => ({
                    name: group.name,
                    count: group.endpointCount,
                    region: '(Not Set)',
                    cpuUsage: numeral(group.cpuUsage).format('%'),
                    memoryUsage: numeral(group.memoryUsage).format('%')
                }))
            });
        }
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
