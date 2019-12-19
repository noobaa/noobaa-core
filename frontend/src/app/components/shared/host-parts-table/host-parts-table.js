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
        name: 'version'
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
    version = ko.observable();
    start = ko.observable();
    end = ko.observable();
    size = ko.observable();
}

class HostPartsTableViewModel extends ConnectableViewModel {
    columns = columns;
    pathname = '';
    dataReady = ko.observable();
    subject = ko.observable();
    emptyMessage = ko.observable();
    partCount = ko.observable();
    partCountFormatted = ko.observable();
    page = ko.observable();
    pageSize = ko.observable();
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
            (resourceType === 'CLOUD_RESOURCE' && 'cloud resource');

        if (!hostParts || !hostParts.parts) {
            ko.assignToProps(this, {
                dataReady: false,
                subject: subject,
                rows: []
            });
        } else {
            const { partCount, parts } = hostParts;
            const { system } = location.params;
            const page = Number(location.query.page) || 0;
            const pageSize = Number(location.query.pageSize) || paginationPageSize.default;

            ko.assignToProps(this, {
                dataReady: true,
                subject,
                emptyMessage: `No object parts are stored on this ${subject}`,
                pathname: location.pathname,
                page,
                pageSize,
                partCount,
                partCountFormatted: numeral(partCount).format(','),
                rows: parts.map(part => {
                    const { mode, objectInfo, start, end } = part;
                    const { bucket, key, version, isUploading, isDeleteMarker } = objectInfo;
                    const href = (!isUploading && !isDeleteMarker) ?
                        realizeUri(routes.object, { system, bucket, object: key, version }) :
                        undefined;

                    return {
                        state: modeToIcon[mode],
                        object: {
                            text: key,
                            href: href,
                            tooltip: key
                        },
                        version: version,
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
        this._query({ page });
    }

    onPageSize(pageSize) {
        this._query({
            pageSize,
            page: 0
        });
    }

    _query(query) {
        const {
            pageSize = this.pageSize(),
            page = this.page()
        } = query;

        const url = realizeUri(this.pathname, null, { page, pageSize });
        this.dispatch(requestLocation(url));
    }
}

export default {
    viewModel: HostPartsTableViewModel,
    template: template
};

