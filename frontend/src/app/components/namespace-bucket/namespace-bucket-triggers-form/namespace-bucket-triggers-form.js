/* Copyright (C) 2016 NooBaa */

import template from './namespace-bucket-triggers-form.html';
import ConnectableViewModel from 'components/connectable';
import ko from 'knockout';
import moment from 'moment';
import { deepFreeze, createCompareFunc } from 'utils/core-utils';
import { realizeUri } from 'utils/browser-utils';
import { bucketEvents } from 'utils/bucket-utils';
import { paginationPageSize } from 'config';
import {
    openAddBucketTriggerModal,
    openEditBucketTriggerModal,
    removeBucketTrigger,
    requestLocation
} from 'action-creators';
import * as routes from 'routes';

const columns = deepFreeze([
    {
        name: 'state',
        type: 'icon',
        sortable: true,
        compareKey: trigger => trigger.enabled
    },
    {
        name: 'funcName',
        label: 'Function Name',
        type: 'link',
        sortable: true,
        compareKey: trigger => trigger.func.name
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

function _mapTriggerToRow(trigger, system, selectedForDelete) {
    const event = bucketEvents
        .find(event => event.value === trigger.event)
        .label;

    const func = trigger.func.name;
    const funcName = {
        text: func,
        href: realizeUri(routes.func, { system, func })
    };

    const lastRun = trigger.lastRun ?
        moment(trigger.lastRun).fromNow() :
        '(never run)';

    return {
        state: modeToStatus[trigger.mode],
        funcName,
        event,
        prefix: trigger.prefix || '(not set)',
        suffix: trigger.suffix || '(not set)',
        lastRun,
        triggerId: trigger.id,
        delete: {
            active: selectedForDelete === trigger.id
        }
    };
}

class TriggerRowViewModel {
    table = null;
    state = ko.observable();
    funcName = ko.observable();
    event = ko.observable();
    prefix = ko.observable();
    suffix = ko.observable();
    lastRun = ko.observable();
    triggerId = ko.observable();
    edit = {
        id: this.triggerId,
        icon: 'edit',
        tooltip: 'Edit Trigger',
        onClick: id => this.table.onEditTrigger(id)
    };
    delete = {
        text: 'Delete trigger',
        disabled: false,
        active: ko.observable(),
        id: this.triggerId,
        onToggle: id => this.table.onSelectForDelete(id),
        onDelete: id => this.table.onDeleteTrigger(id)
    };

    constructor({ table }) {
        this.table = table;
    }
}

class NamespaceBucketTriggersFormViewModel extends ConnectableViewModel {
    dataReady = ko.observable();
    bucketName = '';
    columns = columns;
    pathname = '';
    sorting = ko.observable({});
    pageSize = paginationPageSize;
    page = ko.observable();
    selectedForDelete = '';
    triggerCount = ko.observable();
    rows = ko.observableArray()
        .ofType(TriggerRowViewModel, { table: this });

    selectState(state, params) {
        return [
            params.bucket,
            state.bucketTriggers,
            state.location
        ];
    }

    mapStateToProps(bucketName, triggers, location) {
        if (!triggers || location.params.tab !== 'triggers') {
            ko.assignToProps(this, {
                dataReady: false
            });

        } else {
            const bucketTriggers = Object.values(triggers)
                .filter(trigger => {
                    const { kind, name } = trigger.bucket;
                    return kind === 'NAMESPACE_BUCKET' && name === bucketName;
                });
            const { params, query, pathname } = location;
            const { sortBy = 'funcName', selectedForDelete } = query;
            const page = Number(query.page) || 0;
            const order = Number(query.page) || 1;
            const { compareKey } = columns.find(column => column.name === sortBy);
            const pageStart = page * this.pageSize;
            const triggerList = Object.values(bucketTriggers);
            const rows = triggerList
                .sort(createCompareFunc(compareKey, order))
                .slice(pageStart, pageStart + this.pageSize)
                .map(trigger => _mapTriggerToRow(trigger, params.system, selectedForDelete));

            ko.assignToProps(this, {
                dataReady: true,
                bucketName,
                triggerCount: triggerList.length,
                pathname,
                sorting: { sortBy, order },
                page,
                selectedForDelete,
                rows: rows
            });
        }
    }

    onAddTrigger() {
        this.dispatch(openAddBucketTriggerModal(this.bucketName));
    }

    onEditTrigger(triggerId) {
        this.dispatch(openEditBucketTriggerModal('BUCKET', triggerId));
    }

    onDeleteTrigger(triggerId) {
        this.dispatch(removeBucketTrigger(this.bucketName, triggerId));
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

    onSelectForDelete(selected) {
        this._query({ selectedForDelete: selected });
    }

    _query(params) {
        const {
            sortBy = this.sorting().sortBy,
            order = this.sorting().order,
            page = this.page(),
            selectedForDelete = this.selectedForDelete
        } = params;

        const query = {
            sortBy,
            order,
            page,
            selectedForDelete: selectedForDelete || undefined
        };

        this.dispatch(requestLocation(realizeUri(this.pathname, {}, query)));
    }
}

export default {
    viewModel: NamespaceBucketTriggersFormViewModel,
    template: template
};
