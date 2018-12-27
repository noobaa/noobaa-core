/* Copyright (C) 2016 NooBaa */

import template from './host-parts-table.html';
import ConnectableViewModel from 'components/connectable';
import { requestLocation } from 'action-creators';
import ko from 'knockout';
import { paginationPageSize } from 'config';
import { deepFreeze } from 'utils/core-utils';
import { realizeUri } from 'utils/browser-utils';
import numeral from 'numeral';
import * as routes from 'routes';

const columns = deepFreeze([
    {
        name: 'state',
        type: 'icon'
    },
    {
        name: 'object',
        type: 'link'
    },
    {
        name: 'bucket',
        type: 'link'
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

const modeToIcon = deepFreeze({
    AVAILABLE: {
        name: 'healthy',
        css: 'success',
        tooltip: 'Available'
    },
    BUILDING: {
        name: 'working',
        css: 'warning',
        tooltip: 'In process'
    },
    UNAVAILABLE: {
        name: 'problem',
        css: 'error',
        tooltip: 'Unavailable'
    }
});

class PartRowViewModel {
    state = ko.observable();
    object = ko.observable();
    bucket = ko.observable();
    start = ko.observable();
    end = ko.observable();
    size = ko.observable();
}

class HostPartsTableViewModel extends ConnectableViewModel {
    columns = columns;
    pageSize = paginationPageSize;
    pathname = '';
    dataReady = ko.observable();
    subject = ko.observable();
    emptyMessage = ko.observable();
    partCount = ko.observable();
    partCountFormatted = ko.observable();
    page = ko.observable();
    rows = ko.observableArray()
        .ofType(PartRowViewModel)

    selectState(state, params) {
        const hostParts = state.hostParts.host === params.hostName ?
            state.hostParts :
            null;

        return [
            params.resourceType,
            hostParts,
            state.location
        ];
    }

    mapStateToProps(resourceType, hostParts, location) {
        const subject =
            (resourceType === 'HOST' && 'node') ||
            (resourceType === 'CLOUD_RESOURCE' && 'cloud resoruce');

        if (!hostParts || hostParts.fetching || !hostParts.parts) {
            ko.assignToProps(this, {
                dataReady: false,
                subject: subject,
                rows: []
            });
        } else {
            const { partCount, parts } = hostParts;
            const { system } = location.params;
            const page = Number(location.query.page || 0);

            ko.assignToProps(this, {
                dataReady: true,
                subject: subject,
                emptyMessage: `No object parts are stored on this ${subject}`,
                pathname: location.pathname,
                page: page,
                partCount: partCount,
                partCountFormatted: numeral(partCount).format(','),
                rows: parts.map(part => {
                    const { mode, bucket, object, version, start, end } = part;
                    return {
                        state: modeToIcon[mode],
                        object: {
                            text: object,
                            href: realizeUri(routes.object, { system, bucket, object, version }),
                            tooltip: object
                        },
                        bucket: {
                            text: bucket,
                            href: realizeUri(routes.bucket, { system, bucket }),
                            tooltip: bucket
                        },
                        start: numeral(start).format('0.0 b'),
                        end: numeral(end).format('0.0 b'),
                        size: numeral(end - start).format('0.0 b')
                    };
                })
            });
        }
    }

    onPage(page) {
        const nextPageUri = realizeUri(this.pathname, null, { page });
        this.dispatch(requestLocation(nextPageUri));
    }
}

export default {
    viewModel: HostPartsTableViewModel,
    template: template
};

