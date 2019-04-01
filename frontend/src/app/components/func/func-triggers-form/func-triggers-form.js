/* Copyright (C) 2016 NooBaa */

import ko from 'knockout';
import moment from 'moment';
import template from './func-triggers-form.html';
import ConnectableViewModel from 'components/connectable';
import { deepFreeze, flatMap, createCompareFunc } from 'utils/core-utils';
import { realizeUri } from 'utils/browser-utils';
import { paginationPageSize } from 'config';
import { 
    openAddFuncTriggerModal, 
    requestLocation, 
    removeBucketTrigger,
    openEditFuncTriggerModal
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
        onClick: triggerId => this.table.onEditTrigger(triggerId, this.bucketName.text())
    };
    delete = {
        text: 'Delete Trigger',
        active: ko.observable(),
        id: ko.observable(),
        onToggle: triggerId => this.table.onSelectForDelete(triggerId),
        onDelete: triggerId => this.table.onDeleteTrigger(triggerId, this.bucketName.text())
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
    funcName = ko.observable();
    triggersCount = ko.observable();
    sorting = ko.observable({});
    rows = ko.observableArray().ofType(BucketRowViewModel, { table: this });
    triggersLoaded =  ko.observable();
    pageSize = paginationPageSize;
    page = ko.observable();
    selectedForDelete = ko.observable();
    pathname = '';
    columns = columns;
    funcVersion = '';

    selectState(state, params) {
        const { functions , buckets } = state;
        const { funcName, funcVersion } = params;
        const id = `${funcName}:${funcVersion}`;
        return [
            state.location,
            funcName,
            functions && functions[id],
            buckets
        ];
    }

    mapStateToProps(location, funcName, func, buckets) {
        if (!func || !buckets) {
            ko.assignToProps(this, {
                dataReady: false,
                funcName
            });
        } else {
            const { query, params, pathname } = location;
            const { sortBy = 'bucketName', selectedForDelete } = query;
            const page = Number(query.page || 0);
            const order = Number(query.order || 1);
            const { compareKey } = columns.find(column => column.name === sortBy);
            const pageStart = Number(page) * this.pageSize;
            const triggers = flatMap(
                Object.values(buckets), 
                bucket => Object.values(bucket.triggers)
                    .filter(
                        trigger => trigger.func.name === func.name &&
                        trigger.func.version === func.version
                    )
                    .map(trigger => ({
                        ...trigger, 
                        bucketName: bucket.name,
                        bucketType: 'Data Bucket'
                    }))
            );

            this.triggersCount(triggers.length);
            ko.assignToProps(this, {
                dataReady: true,
                funcName,
                funcVersion: func.version,
                rows: Object.values(triggers)
                    .sort(createCompareFunc(compareKey, Number(order)))
                    .slice(pageStart, pageStart + this.pageSize)
                    .map(trigger => ({                        
                        state: modeToStatus[trigger.mode],
                        bucketName: {
                            text: trigger.bucketName,
                            href: realizeUri(
                                routes.bucket, 
                                { system: params.system, bucket: trigger.bucketName }
                            )
                        },
                        bucketType: trigger.bucketType,
                        event: trigger.event,
                        prefix: trigger.prefix || '(not set)',
                        suffix: trigger.suffix || '(not set)',
                        lastRun: _getLastRunText(trigger),
                        delete: { 
                            id: trigger.id,
                            active: selectedForDelete === trigger.id
                        },
                        edit: { id: trigger.id }
                    }))
            });
            this.pathname = pathname;
            this.page(Number(page));
            this.sorting({ sortBy, order: Number(order) });
            this.selectedForDelete = selectedForDelete;
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
        this.dispatch(openAddFuncTriggerModal(
            this.funcName()
        ));
    }

    onEditTrigger(triggerId) {
        this.dispatch(openEditFuncTriggerModal(this.funcName(), this.funcVersion, triggerId));
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
