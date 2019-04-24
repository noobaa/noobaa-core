/* Copyright (C) 2016 NooBaa */

import ko from 'knockout';
import moment from 'moment';
import numeral from 'numeral';
import template from './func-triggers-form.html';
import ConnectableViewModel from 'components/connectable';
import { deepFreeze, createCompareFunc } from 'utils/core-utils';
import { realizeUri } from 'utils/browser-utils';
import { paginationPageSize } from 'config';
import {
    openAddBucketTriggerModal,
    requestLocation,
    removeBucketTrigger,
    openEditBucketTriggerModal
} from 'action-creators';


import * as routes from 'routes';

const modeToStatus = deepFreeze({
    DISABLED: {
        name: 'healthy',
        css: 'disabled',
        tooltip: 'Disabled'
    },
    MISSING_PERMISSIONS: {
        name: 'problem',
        css: 'warning',
        tooltip: 'Access issue'
    },
    OPTIMAL: {
        name: 'healthy',
        css: 'success',
        tooltip: 'Healthy'
    }
});

const bucketTypeMeta = deepFreeze({
    DATA_BUCKET: {
        displayName: 'Data',
        route: routes.bucket
    },
    NAMESPACE_BUCKET: {
        displayName: 'Namespace',
        route: routes.namespaceBucket
    }
});

const columns = deepFreeze([
    {
        name: 'state',
        type: 'icon',
        sortable: true,
        compareKey: trigger => trigger.enabled
    },
    {
        name: 'bucketName',
        label: 'Bucket Name',
        type: 'link',
        sortable: true,
        compareKey: trigger => trigger.bucketName
    },
    {
        name: 'bucketType',
        label: 'Bucket Type'
    },
    {
        name: 'event',
        label: 'Event Type',
        sortable: true,
        compareKey: trigger => trigger.event
    },
    {
        name: 'prefix',
        sortable: true,
        compareKey: trigger => trigger.prefix
    },
    {
        name: 'suffix',
        sortable: true,
        compareKey: trigger => trigger.suffix
    },
    {
        name: 'lastRun',
        label: 'Last Run',
        sortable: true,
        compareKey: trigger => trigger.lastRun || 0
    },
    {
        name: 'edit',
        label: '',
        type: 'iconButton'
    },
    {
        name: 'delete',
        label: '',
        type: 'delete'
    }
]);


class BucketRowViewModel {
    table = null;
    state = {
        name: ko.observable(),
        css: ko.observable(),
        tooltip: ko.observable()
    };
    bucketName = {
        text: ko.observable(),
        href: ko.observable()
    };
    bucketType = ko.observable();
    event = ko.observable();
    prefix = ko.observable();
    suffix = ko.observable();
    lastRun = ko.observable();
    edit = {
        id: ko.observable(),
        icon: 'edit',
        tooltip: 'Edit Trigger',
        onClick: triggerId => this.table.onEditTrigger(
            triggerId,
            this.bucketName.text()
        )
    };
    delete = {
        text: 'Delete Trigger',
        active: ko.observable(),
        id: ko.observable(),
        onToggle: triggerId => this.table.onSelectForDelete(triggerId),
        onDelete: triggerId => this.table.onDeleteTrigger(
            triggerId,
            this.bucketName.text()
        )
    };

    constructor({ table }) {
        this.table = table;
    }
}

function _getLastRunText(trigger) {
    const { lastRun } = trigger;
    return lastRun ? moment(lastRun).fromNow() : '(never run)';
}

class FuncTriggersFormViewModel extends ConnectableViewModel {
    dataReady = ko.observable();
    funcId = '';
    triggerCount = ko.observable();
    sorting = ko.observable({});
    rows = ko.observableArray().ofType(BucketRowViewModel, { table: this });
    pageSize = paginationPageSize;
    page = ko.observable();
    selectedForDelete = ko.observable();
    pathname = '';
    columns = columns;

    selectState(state, params) {
        const { functions , bucketTriggers } = state;
        const id = `${params.funcName}:${params.funcVersion}`;
        return [
            state.location,
            functions && functions[id],
            bucketTriggers
        ];
    }

    mapStateToProps(location, func, triggers) {
        if (!func || !triggers) {
            ko.assignToProps(this, {
                dataReady: false
            });

        } else {
            const { query, params, pathname } = location;
            const { sortBy = 'bucketName', selectedForDelete } = query;
            const page = Number(query.page || 0);
            const order = Number(query.order || 1);
            const { compareKey } = columns.find(column => column.name === sortBy);
            const pageStart = page * paginationPageSize;

            const rows = Object.values(triggers)
                .filter(trigger =>
                    trigger.func.name === func.name &&
                    trigger.func.version === func.version
                )
                .sort(createCompareFunc(compareKey, order))
                .slice(pageStart, pageStart + paginationPageSize)
                .map(trigger => {
                    const { name: bucketName, kind: bucketType } = trigger.bucket;
                    const { displayName: bucketTypeDisplay, route } = bucketTypeMeta[bucketType];
                    return {
                        state: modeToStatus[trigger.mode],
                        bucketName: {
                            text: bucketName,
                            href: realizeUri(route, {
                                system: params.system,
                                bucket: bucketName
                            })
                        },
                        bucketType: bucketTypeDisplay,
                        event: trigger.event,
                        prefix: trigger.prefix || '(not set)',
                        suffix: trigger.suffix || '(not set)',
                        lastRun: _getLastRunText(trigger),
                        delete: {
                            id: trigger.id,
                            active: selectedForDelete === trigger.id
                        },
                        edit: { id: trigger.id }
                    };
                });

            ko.assignToProps(this, {
                dataReady: true,
                funcId: `${func.name}:${func.version}`,
                pathname: pathname,
                page: page,
                sorting: { sortBy, order },
                selectedForDelete,
                triggerCount: numeral(rows.length).format(','),
                rows
            });
        }
    }

    onSort(sorting) {
        this._query({
            ...sorting,
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

    onAddTrigger() {
        this.dispatch(openAddBucketTriggerModal(null, this.funcId));
    }

    onEditTrigger(triggerId) {
        this.dispatch(openEditBucketTriggerModal('FUNCTION', triggerId));
    }

    onSelectForDelete(triggerId) {
        this._query({
            selectedForDelete: triggerId
        });
    }

    onDeleteTrigger(triggerId, bucketName) {
        this.dispatch(removeBucketTrigger(bucketName, triggerId));
    }

    _query(params) {
        const {
            sortBy = this.sorting().sortBy,
            order = this.sorting().order,
            page = this.page(),
            selectedForDelete = this.selectedForDelete()
        } = params;

        const query = {
            sortBy,
            order,
            page,
            selectedForDelete: selectedForDelete || undefined
        };

        const url = realizeUri(this.pathname, {}, query);
        this.dispatch(requestLocation(url));
    }
}

export default {
    viewModel: FuncTriggersFormViewModel,
    template: template
};
