/* Copyright (C) 2016 NooBaa */

import template from './host-parts-table.html';
import Observer from 'observer';
import PartRowViewModel from './part-row';
import { state$, action$ } from 'state';
import { fetchHostObjects, requestLocation } from 'action-creators';
import ko from 'knockout';
import { paginationPageSize } from 'config';
import { deepFreeze } from 'utils/core-utils';
import { realizeUri } from 'utils/browser-utils';
import numeral from 'numeral';

const columns = deepFreeze([
    {
        name: 'state',
        type: 'icon'
    },
    {
        name: 'object',
        type: 'newLink'
    },
    {
        name: 'bucket'
    },
    {
        name: 'start'
    },
    {
        name: 'end'
    },
    {
        name: 'size'
    }
]);

class HostPartsTableViewModel extends Observer {
    constructor() {
        super();

        this.baseRoute = '';
        this.columns = columns;
        this.pageSize = paginationPageSize;
        this.fetching = ko.observable();
        this.partCount = ko.observable();
        this.partCountFormatted = ko.observable();
        this.rows = ko.observableArray();
        this.page = ko.observable();

        this.observe(state$.get('location'), this.onLocation);
        this.observe(state$.get('hostParts'), this.onParts);
    }

    onLocation({ route, params, query }) {
        const { system, pool, host, tab } = params;
        const page = Number(query.page || 0);
        if (!host) return;

        this.baseRoute = realizeUri(route, { system, pool, host, tab });
        this.system = system;
        this.page(page);

        action$.onNext(fetchHostObjects(
            params.host,
            page * this.pageSize,
            this.pageSize
        ));
    }

    onParts({ fetching, partCount, parts }) {
        if (!parts) {
            this.fetching(fetching);
            this.rows([]);
            return;
        }

        const rows = parts.map((part, i) => {
            const row = this.rows()[i] || new PartRowViewModel();
            row.onPart(part, this.system);
            return row;
        });

        this.fetching(false);
        this.partCount(partCount);
        this.partCountFormatted(numeral(partCount).format('0,0'));
        this.rows(rows);
    }

    onPage(page) {
        const nextPageUri = realizeUri(this.baseRoute, {}, { page });
        action$.onNext(requestLocation(nextPageUri));
    }
}

export default {
    viewModel: HostPartsTableViewModel,
    template: template
};

