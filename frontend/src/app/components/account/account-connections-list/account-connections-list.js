/* Copyright (C) 2016 NooBaa */

import template from './account-connections-list.html';
import ConnectableViewModel from 'components/connectable';
import { throttle, keyByProperty, createCompareFunc } from 'utils/core-utils';
import { includesIgnoreCase, stringifyAmount } from 'utils/string-utils';
import { cloudServices } from 'utils/cloud-utils';
import { realizeUri } from 'utils/browser-utils';
import { flatPlacementPolicy } from 'utils/bucket-utils';
import { paginationPageSize, inputThrottle } from 'config';
import ko from 'knockout';
import * as routes from 'routes';
import {
    requestLocation,
    openAddCloudConnectionModal,
    openEditCloudConnectionModal,
    deleteExternalConnection
} from 'action-creators';

const cloudServiceByType = keyByProperty(
    cloudServices,
    'value'
);

function _mapCloudResourceUsage(usage, bucketList, system, serviceMeta,) {
    const buckets = bucketList
        .filter(bucket => flatPlacementPolicy(bucket).some(record =>{
            const { type, name } = record.resource;
            return type === 'CLOUD' && name == usage.entity;
        }))
        .map(bucket => {
            const { name } = bucket;
            const url = realizeUri(routes.bucket, { system, bucket: name });
            return { name, url };
        });

    return {
        entityType: 'cloud resource',
        entityName: usage.entity,
        entityUrl: realizeUri(routes.cloudResource, { system, resource: usage.entity }),
        usageDetails: [
            {
                label: `${serviceMeta.displayName} target ${serviceMeta.subject.toLowerCase()} name`,
                value: usage.externalEntity
            },
            {
                value: buckets
            }
        ]
    };
}

function _mapNamespaceResourceUsage(usage, nsBucketList, system, serviceMeta,) {
    const buckets = nsBucketList
        .filter(bucket => {
            const { writeTo, readFrom } = bucket.placement;
            return (writeTo === usage.entity) || readFrom.includes(usage.entity);
        })
        .map(bucket => {
            const { name } = bucket;
            const url = realizeUri(routes.namespaceBucket, { system, bucket: name });
            return { name, url };
        });

    return {
        entityType: 'namespace resource',
        entityName: usage.entity,
        entityUrl: '',
        usageDetails: [
            {
                label: `${serviceMeta.displayName} target ${serviceMeta.subject.toLowerCase()} name`,
                value: usage.externalEntity
            },
            {
                value: buckets
            }
        ]
    };
}

function _mapConnectionDetails(connection, bucketList, nsBucketList, system) {
    if (!connection) {
        return;
    }
    const serviceMeta = cloudServiceByType[connection.service];
    return {
        connName: connection.name,
        connInfo: [
            {
                value: connection.endpoint
            },
            {
                label: serviceMeta.identityDisplayName,
                value: connection.identity
            }
        ],
        usageList: connection.usage.map(usage => {
            const { usageType } = usage;
            if (usageType === 'CLOUD_RESOURCE') {
                return _mapCloudResourceUsage(usage, bucketList, system, serviceMeta);
            }

            if (usageType === 'NAMESPACE_RESOURCE') {
                return _mapNamespaceResourceUsage(usage, nsBucketList, system, serviceMeta);
            }

            throw new Error(`Invalid usage type, got ${usageType}`);
        })
    };
}

function _mapConnectionRow(connection, isSummaryVisible, isSelectedForDelete) {
    const connectionInUse = connection.usage.length > 0;
    return {
        icon: cloudServiceByType[connection.service].icon,
        name: connection.name,
        usage: `Used by ${stringifyAmount('resource', connection.usage.length)}`,
        isSummaryVisible,
        targetEndpoint: connection.endpoint,
        identity: connection.identity,
        deleteBtn: {
            id: connection.name,
            tooltip: connectionInUse ?
                'Cannot delete currently used connection' :
                'Delete Connection',
            isActive: isSelectedForDelete,
            isDisabled: connectionInUse
        }
    };
}

class ConnectionRowViewModel {
    list = null;
    icon = ko.observable();
    name = ko.observable();
    usage = ko.observable();
    isSummaryVisible = ko.observable();
    targetEndpoint = ko.observable();
    identity = ko.observable();
    deleteBtn = {
        id: ko.observable(),
        text: 'Delete Connection',
        tooltip: ko.observable(),
        isActive: ko.observable(),
        isDisabled: ko.observable(),
        onToggle: this.onToggleDelete.bind(this),
        onDelete: this.onDelete.bind(this)
    };

    constructor({ list }) {
        this.list = list;
    }

    onEdit(connName) {
        this.list.onEditConnection(connName);
    }

    onToggleDelete(connName) {
        this.list.onSelectForDelete(connName);
    }

    onDelete(connName) {
        this.list.onDeleteConnection(connName);
    }
}

class ConnectionDetailsViewModel {
    list = null;
    connName = ko.observable();
    connInfo = [
        {
            label: 'Endpoint',
            value: ko.observable()
        },
        {
            label: ko.observable(),
            value: ko.observable()
        }
    ];
    usageList = ko.observableArray()
        .ofType(ConnectionUsageViewModel);

    constructor( { list }) {
        this.list = list;
    }

    onX() {
        this.list.onCloseDetails();
    }
}

class ConnectionUsageViewModel {
    entityType = ko.observable();
    entityName = ko.observable();
    entityUrl = ko.observable();
    targetEntity = ko.observable();
    usageDetails = [
        {
            label: ko.observable(),
            value: ko.observable()
        },
        {
            label: 'Used as a resource in the following buckets',
            template: 'bucketList',
            value: ko.observableArray()
        }
    ];
}

class AccountConnectionsListViewModel extends ConnectableViewModel {
    dataReady = ko.observable();
    accountName = '';
    pathname = '';
    pageSize = paginationPageSize;
    filter = ko.observable();
    page = ko.observable();
    selectedForDelete = ko.observable();
    connectionCount = ko.observable();
    emptyMessage = ko.observable();
    selectedConnection = ko.observable()
    rows = ko.observableArray()
        .ofType(ConnectionRowViewModel, { list: this });
    details = ko.observable()
        .ofType(ConnectionDetailsViewModel, { list: this });

    selectState(state, params) {
        const { accounts, buckets, namespaceBuckets, location } = state;
        const { externalConnections } = accounts ? accounts[params.accountName] : {};
        return [
            params.accountName,
            externalConnections,
            buckets,
            namespaceBuckets,
            location
        ];
    }

    mapStateToProps(accountName, connections, buckets, nsBuckets, location) {
        if (!connections || !buckets || !nsBuckets) {
            ko.assignToProps(this, {
                dataReady: false
            });
        } else {
            const { pathname, query, params } = location;
            const { filter = '', selectedConnection = '', selectedForDelete = '' } = query;
            const page = Number(query.page || 0);
            const pageStart = page * paginationPageSize;
            const filteredConnections = connections
                .filter(conn =>
                    includesIgnoreCase(conn.name, filter) ||
                    includesIgnoreCase(conn.endpoint, filter) ||
                    includesIgnoreCase(conn.identity, filter)
                )
                .slice(pageStart, pageStart + this.pageSize)
                .sort(createCompareFunc(conn => conn.service));
            const connectionCount = filteredConnections.length;
            const emptyMessage =
                (connections.length === 0 && 'The account has no external connections') ||
                (connectionCount === 0 && 'The current filter does not match any connection') ||
                '';

            ko.assignToProps(this, {
                dataReady: true,
                accountName,
                pathname,
                selectedConnection,
                filter,
                page,
                selectedForDelete,
                connectionCount,
                emptyMessage,
                rows: filteredConnections.map(connection => _mapConnectionRow(
                    connection,
                    !selectedConnection,
                    selectedForDelete === connection.name
                )),
                details: _mapConnectionDetails(
                    filteredConnections.find(connection =>
                        connection.name === selectedConnection
                    ),
                    Object.values(buckets),
                    Object.values(nsBuckets),
                    params.system
                )
            });
        }
    }

    onAddConnection() {
        this.dispatch(openAddCloudConnectionModal());
    }

    onFilter = throttle(
        filter => this._query({
            filter,
            page: 0,
            selectedConnection: '',
            selectedForDelete: ''
        }),
        inputThrottle
    );

    onPage(page) {
        this._query({
            page,
            selectedForDelete: ''
        });
    }

    onSelectConnection(selectedConnection) {
        this._query({
            selectedConnection,
            selectedForDelete: ''
        });
    }

    onCloseDetails() {
        this._query({
            selectedConnection: ''
        });
    }

    onEditConnection(connName) {
        this.dispatch(openEditCloudConnectionModal(
            this.accountName,
            connName
        ));
    }

    onSelectForDelete(selectedForDelete) {
        this._query({ selectedForDelete });
    }

    onDeleteConnection(connName) {
        this.dispatch(deleteExternalConnection(connName));
    }

    _query(query) {
        const {
            selectedConnection = this.selectedConnection(),
            filter = this.filter(),
            page = this.page(),
            selectedForDelete = this.selectedForDelete()
        } = query;

        const url = realizeUri(this.pathname, null, {
            selectedConnection: selectedConnection !== '' ?
                selectedConnection :
                undefined,
            filter: filter !== '' ?
                filter :
                undefined,
            page: page,
            selectedForDelete: selectedForDelete !== '' ?
                selectedForDelete :
                undefined
        });

        this.dispatch(requestLocation(url));
    }
}

export default {
    viewModel: AccountConnectionsListViewModel,
    template: template
};
