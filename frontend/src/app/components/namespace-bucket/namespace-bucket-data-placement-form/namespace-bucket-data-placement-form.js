/* Copyright (C) 2016 NooBaa */

import template from './namespace-bucket-data-placement-form.html';
import ConnectableViewModel from 'components/connectable';
import { deepFreeze, pick } from 'utils/core-utils';
import ko from 'knockout';
import { getNamespaceResourceStateIcon, getNamespaceResourceTypeIcon } from 'utils/resource-utils';
import { openEditNamespaceBucketDataPlacementModal } from 'action-creators';

const columns = deepFreeze([
    {
        name: 'state',
        type: 'icon'
    },
    {
        name: 'type',
        type: 'icon'
    },
    {
        name: 'name',
        type: 'nameAndRule',
        label: 'Namespace Resource Name'
    },
    {
        name: 'target',
        label: 'Target Name'
    }
]);

class ResourceRowViewModel {
    state = ko.observable();
    type = ko.observable();
    name = ko.observable();
    target = ko.observable();
}

class NamespaceBucketDataPlacementFormViewModel extends ConnectableViewModel {
    columns = columns;
    dataReady = ko.observable();
    bucketName = '';
    rows = ko.observableArray()
        .ofType(ResourceRowViewModel);

    selectState(state, params) {
        const { namespaceBuckets, namespaceResources } = state;
        return [
            namespaceBuckets && namespaceBuckets[params.bucket],
            namespaceResources
        ];
    }

    mapStateToProps(bucket, resources) {
        if (!bucket || !resources) {
            ko.assignToProps(this, {
                dataReady: false
            });

        } else {
            const { readFrom, writeTo } = bucket.placement;
            const resourceList = Object.values(pick(resources, readFrom));

            ko.assignToProps(this, {
                dataReady: true,
                bucketName: bucket.name,
                rows: resourceList.map(resource => ({
                    state: getNamespaceResourceStateIcon(resource),
                    type: getNamespaceResourceTypeIcon(resource),
                    name: {
                        name: resource.name,
                        rule: resource.name === writeTo ? 'Read & Write' : 'Read'
                    },
                    target: resource.target
                }))
            });
        }
    }

    onEditPlacement() {
        this.dispatch(openEditNamespaceBucketDataPlacementModal(
            this.bucketName
        ));
    }
}

export default {
    viewModel: NamespaceBucketDataPlacementFormViewModel,
    template: template
};
