/* Copyright (C) 2016 NooBaa */

import template from './funcs-table.html';
import ConnectableViewModel from 'components/connectable';
import ko from 'knockout';
import moment from 'moment';
import { deepFreeze, createCompareFunc, throttle } from 'utils/core-utils';
import { formatSize } from 'utils/size-utils';
import { realizeUri } from 'utils/browser-utils';
import { includesIgnoreCase } from 'utils/string-utils';
import * as routes from 'routes';
import { paginationPageSize, inputThrottle, timeShortFormat } from 'config';
import {
    requestLocation,
    openCreateFuncModal,
    deleteLambdaFunc
} from 'action-creators';

const columns = deepFreeze([
    {
        name: 'state',
        type: 'icon',
        sortable: true,
        compareKey: () => true

    },
    {
        name: 'name',
        label: 'function name',
        type: 'link',
        sortable: true,
        compareKey: func => func.name
    },
    {
        name: 'description',
        sortable: true,
        compareKey: func => func.description
    },
    {
        name: 'size',
        sortable: true,
        compareKey: func => func.size
    },
    {
        name: 'lastModified',
        sortable: true,
        compareKey: func => func.lastModified
    },
    {
        name: 'deleteButton',
        label: '',
        css: 'delete-col',
        type: 'delete'
    }
]);

function _mapFunc(func, system, selectedForDelete) {
    const { name, version, description, codeSize, lastModified } = func;
    const id = `${name}:${version}`;
    return {
        name: {
            text: name,
            href: realizeUri(routes.func, { system, func: name }),
            tooltip: { text: name, breakWords: true }
        },
        description,
        size: formatSize(codeSize),
        lastModified: moment(lastModified).format(timeShortFormat),
        deleteButton: {
            id: id,
            active: id === selectedForDelete
        }
    };
}

class FuncRowViewModel {
    table = null;
    state = {
        name: 'healthy',
        css: 'success',
        tooltip: 'Deployed'
    };
    name = ko.observable();
    description = ko.observable();
    size = ko.observable();
    lastModified = ko.observable();
    deleteButton = {
        text: 'Delete function',
        tooltip: 'delete function',
        id: ko.observable(),
        active: ko.observable(),
        onDelete: id => this.table.onDeleteFunc(id),
        onToggle: id => this.table.onSelectFuncForDelete(id)
    };

    constructor({ table }) {
        this.table = table;
    }
}

class FuncsTableViewModel extends ConnectableViewModel {
    columns = columns;
    pageSize = paginationPageSize;
    dataReady = ko.observable();
    pathname = '';
    funcCount = ko.observable();
    filter = ko.observable();
    sorting = ko.observable();
    page = ko.observable();
    emptyMessage = ko.observable();
    rows = ko.observableArray()
        .ofType(FuncRowViewModel, { table: this });

    selectState(state) {
        return [
            state.functions,
            state.location
        ];
    }

    mapStateToProps(funcs, location) {
        if (!funcs) {
            ko.assignToProps(this, {
                dataReady: false
            });

        } else {
            const { pathname, params, query } = location;
            const { filter = '', sortBy = 'name', selectedForDelete = '' } = query;
            const order = Number(query.order || 1);
            const page = Number(query.page || 0);
            const { compareKey } = columns.find(column => column.name === sortBy);

            const funcList = Object.values(funcs);
            const filtered = funcList
                .filter(func => includesIgnoreCase(func.name, filter));
            const rows = filtered
                .sort(createCompareFunc(compareKey, order))
                .slice(page * paginationPageSize, (page + 1) * paginationPageSize)
                .map(func => _mapFunc(func, params.system, selectedForDelete));

            const emptyMessage =
                (funcList.length === 0 && 'No restless functions configured') ||
                (filtered.length === 0 && 'The current filter does not match any function') ||
                '';


            ko.assignToProps(this, {
                dataReady: true,
                pathname: pathname,
                funcCount: filtered.length,
                filter,
                sorting: { sortBy, order },
                page,
                emptyMessage,
                rows
            });
        }
    }

    onCreateFunc() {
        this.dispatch(openCreateFuncModal());
    }

    onFilter = throttle(filter => {
        this._query({
            filter,
            page: 0,
            selectedForDelete: null
        });
    }, inputThrottle)

    onSort(sorting) {
        this._query({
            sortBy: sorting.sortBy,
            order: sorting.order,
            page: 0,
            selectedForDelete: null
        });
    }

    onPage(page) {
        this._query({
            page,
            selectedForDelete: null
        });
    }

    onSelectFuncForDelete(id = '') {
        this._query({ selectedForDelete: id });
    }

    onDeleteFunc(id) {
        const [name, version] = id.split(':');
        this.dispatch(deleteLambdaFunc(name, version));
    }

    _query(query) {
        const {
            filter = this.filter(),
            sortBy = this.sorting().sortBy,
            order = this.sorting().order,
            page = this.page(),
            selectedForDelete = this.selectedForDelete()
        } = query;

        const queryUrl = realizeUri(this.pathname, null, {
            filter: filter || undefined,
            sortBy: sortBy,
            order: order,
            page: page,
            selectedForDelete: selectedForDelete || undefined
        });

        this.dispatch(requestLocation(queryUrl));
    }
}

export default {
    viewModel: FuncsTableViewModel,
    template: template
};
