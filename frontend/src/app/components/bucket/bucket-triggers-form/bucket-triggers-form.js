/* Copyright (C) 2016 NooBaa */

import template from './bucket-triggers-form.html';
import Observer from 'observer';
import TriggerRowViewModel from './trigger-row';
import ko from 'knockout';
import { deepFreeze, createCompareFunc } from 'utils/core-utils';
import { realizeUri } from 'utils/browser-utils';
import { getMany } from 'rx-extensions';
import { state$, action$ } from 'state';
import { paginationPageSize } from 'config';
import {
    openAddBucketTriggerModal,
    openEditBucketTriggerModal,
    removeBucketTrigger,
    requestLocation
} from 'action-creators';

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
        type: 'newLink',
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

class BucketTriggersFormViewModel extends Observer {
    bucketName = '';
    columns = columns;
    pathname = '';
    bucketLoaded = ko.observable();
    sorting = ko.observable({});
    pageSize = paginationPageSize;
    page = ko.observable();
    selectedForDelete = '';
    triggerCount = ko.observable();
    rows = ko.observableArray();
    rowParams = {
        onEdit: this.onEditTrigger.bind(this),
        onSelectForDelete: this.onSelectForDelete.bind(this),
        onDelete: this.onDeleteTrigger.bind(this)
    };

    constructor({ bucketName }) {
        super();

        this.bucketName = ko.unwrap(bucketName);

        this.observe(
            state$.pipe(
                getMany(
                    ['buckets', this.bucketName, 'triggers'],
                    ['location']
                )
            ),
            this.onState
        );
    }

    onState([triggers, location]) {
        if (location.params.tab !== 'triggers') {
            return;
        }

        if (!triggers) {
            this.bucketLoaded(false);
            return;
        }

        const { system } = location.params;
        const { sortBy = 'funcName', order = 1, page = 0, selectedForDelete } = location.query;
        const { compareKey } = columns.find(column => column.name === sortBy);
        const pageStart = Number(page) * this.pageSize;
        const triggerList = Object.values(triggers);
        const rows = triggerList
            .sort(createCompareFunc(compareKey, Number(order)))
            .slice(pageStart, pageStart + this.pageSize)
            .map((trigger, i) => {
                const row = this.rows.get(i) || new TriggerRowViewModel(this.rowParams);
                row.onState(trigger, system, selectedForDelete);
                return row;
            });

        this.triggerCount(triggerList.length);
        this.pathname = location.pathname;
        this.sorting({ sortBy, order: Number(order) });
        this.page(Number(page));
        this.selectedForDelete = selectedForDelete;
        this.rows(rows);
        this.bucketLoaded(true);
    }

    onAddTrigger() {
        action$.next(openAddBucketTriggerModal(this.bucketName));
    }

    onEditTrigger(triggerId) {
        action$.next(openEditBucketTriggerModal(this.bucketName, triggerId));
    }

    onDeleteTrigger(triggerId) {
        action$.next(removeBucketTrigger(this.bucketName, triggerId));
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

        action$.next(
            requestLocation(realizeUri(this.pathname, {}, query))
        );
    }
}

export default {
    viewModel: BucketTriggersFormViewModel,
    template: template
};
