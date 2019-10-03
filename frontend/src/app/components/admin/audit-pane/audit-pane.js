/* Copyright (C) 2016 NooBaa */

import template from './audit-pane.html';
import ConnectableViewModel from 'components/connectable';
import ko from 'knockout';
import eventDisplayNames from './event-display-names';
import moment from 'moment';
import { deepFreeze, last } from 'utils/core-utils';
import { realizeUri } from 'utils/browser-utils';
import { timeShortFormat, infinitScrollPageSize } from 'config';
import * as routes from 'routes';
import {
    closeDrawer,
    fetchAuditLog,
    exportAuditLog,
    dropAuditLog,
    selectAuditRecord
} from 'action-creators';

const categoryDisplayNames = deepFreeze({
    node: 'Nodes',
    obj: 'Objects',
    bucket: 'Buckets',
    account: 'Accounts',
    resource:'Resources',
    dbg: 'Debug',
    cluster: 'Cluster',
    functions: 'Functions',
    conf: 'Configuration'
});

const categoryOptions = Object.entries(categoryDisplayNames)
    .map(pair => ({ value: pair[0], label: pair[1] }));

const columns = deepFreeze([
    {
        name: 'time'
    },
    {
        name: 'account'
    },
    {
        name: 'category'
    },
    {
        name: 'event'
    },
    {
        name: 'entity',
        type: 'link'
    }
]);

const exportTooltip = deepFreeze({
    text: 'Export as CSV',
    align: 'end'
});

function _mapEntity(entity, system) {
    if (!entity) {
        return { text: '---' };
    }

    switch (entity.kind) {
        case 'node': {
            const { linkable, name: host, pool } = entity;
            return {
                text: host.split('#')[0],
                href: linkable ? realizeUri(routes.host, { system, pool, host }) : ''
            };
        }
        case 'object': {
            const { linkable, key: object, bucket, version  } = entity;
            return {
                text: object,
                href: linkable ? realizeUri(routes.object, { bucket, object, version }) : ''
            };
        }
        case 'bucket': {
            const { linkable, name: bucket } = entity;
            return {
                text: bucket,
                href: linkable ? realizeUri(routes.bucket, { system, bucket }) : ''
            };
        }
        case 'account': {
            const { linkable, name: account } = entity;
            return {
                text: account,
                href: linkable ? realizeUri(routes.account, { system, account }) : ''
            };
        }
        case 'resource': {
            const { linkable, name, resourceType } = entity;
            if (!linkable) {
                return { text: name };

            } else {
                return {
                    text: name,
                    href: (
                        (resourceType === 'HOSTS' && realizeUri(routes.pool, { system, pool: name })) ||
                        (resourceType === 'CLOUD' && realizeUri(routes.cloudResource, { system, resource: name })) ||
                        ''
                    )
                };
            }
        }
        case 'server': {
            const { linkable, name: server } = entity;
            return {
                text: server,
                href: linkable ? realizeUri(routes.server, { system, server }) : ''
            };

        }
        case 'function': {
            const { linkable, name: func } = entity;
            return {
                text: func,
                href: linkable ? realizeUri(routes.func, { system, func }) : ''
            };
        }
    }
}

function _mapItemToRow(item, system, selectedRecord) {
    const { time, actor, category, event, entity, id } = item;
    return {
        id,
        time: moment(time).format(timeShortFormat),
        account: actor ? actor.name : '---',
        category: categoryDisplayNames[category],
        event: eventDisplayNames[`${category}.${event}`] || '',
        entity: _mapEntity(entity, system),
        css: id === selectedRecord ? 'selected' : ''
    };
}

class EventRowViewModel {
    id = '';
    time = ko.observable();
    account = ko.observable();
    category = ko.observable();
    event = ko.observable()
    entity = ko.observable();
    css = ko.observable();
}

class AuditPaneViewModel extends ConnectableViewModel {
    categoryOptions = categoryOptions;
    columns = columns;
    exportTooltip = exportTooltip;
    selectedCategories = ko.observableArray();
    loadState = ko.observable();
    oldestTimestamp = 0;
    desc = ko.observable();
    rows = ko.observableArray()
        .ofType(EventRowViewModel);

    constructor(...args) {
        super(...args);

        this.dispatch(fetchAuditLog(
            { categories: Object.keys(categoryDisplayNames) },
            infinitScrollPageSize
        ));
    }

    selectState(state) {
        const { auditLog, location } = state;
        return [
            auditLog,
            location.params.system
        ];
    }

    mapStateToProps(auditLog, system) {
        if (!auditLog) {
            ko.assignToProps(this, {
                isLoading: true,
                desc: ''
            });

        } else {
            const { loading, loadError, endOfList, categories, list, selectedRecord } = auditLog;
            const loadState =
                (loading > 0 && 'LOADING') ||
                (loadError && 'LOAD_ERROR') ||
                (endOfList && 'ALL_LOADED') ||
                'IDEL';
            const { desc } = selectedRecord ?
                list.find(record => record.id === selectedRecord) :
                { desc: '' };

            ko.assignToProps(this, {
                dataReady: true,
                loadState,
                oldestTimestamp: list.length > 0 ? last(list).time : Date.now(),
                selectedCategories: categories,
                desc,
                rows: list.map(item => _mapItemToRow(item, system, selectedRecord))
            });
        }
    }

    onX() {
        this.dispatch(closeDrawer());
    }

    onSelectAllCategories() {
        this.onSelectCategories(
            Object.keys(categoryDisplayNames)
        );
    }

    onClearAllCategories() {
        this.onSelectCategories([]);
    }

    onSelectCategories(categories) {
        this.dispatch(fetchAuditLog( { categories }, infinitScrollPageSize));
    }

    onSelectedRecord(recordId) {
        this.dispatch(selectAuditRecord(recordId));
        return true;
    }

    onScroll(scrollPos) {
        const loadMoreScrollBound = 1 - (1 / this.rows().length);
        const categories = this.selectedCategories();
        if (this.loadState() === 'IDEL' && scrollPos > loadMoreScrollBound) {
            this.dispatch(fetchAuditLog( { categories }, infinitScrollPageSize, this.oldestTimestamp));
        }
    }

    onRetryLoad() {
        const categories =  this.selectedCategories();
        this.dispatch(fetchAuditLog( { categories }, infinitScrollPageSize, this.oldestTimestamp));
    }

    onExportToCSV() {
        this.dispatch(exportAuditLog(this.selectedCategories()));
    }

    dispose() {
        this.dispatch(dropAuditLog());
        super.dispose();
    }
}

export default {
    viewModel: AuditPaneViewModel,
    template: template
};
