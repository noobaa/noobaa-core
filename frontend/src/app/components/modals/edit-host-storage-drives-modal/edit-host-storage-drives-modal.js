/* Copyright (C) 2016 NooBaa */

import template from './edit-host-storage-drives-modal.html';
import ConnectableViewModel from 'components/connectable';
import { getNodeOrHostCapacityBarValues } from 'utils/host-utils';
import { deepFreeze, keyByProperty, mapValues } from 'utils/core-utils';
import { getFieldValue } from 'utils/form-utils';
import ko from 'knockout';
import {
    openDisableHostStorageWarningModal,
    toggleHostNodes,
    closeModal,
    updateForm
} from 'action-creators';

const columns = deepFreeze([
    {
        name: 'selected',
        label: '',
        type: 'checkbox'
    },
    {
        name: 'mount',
        label: 'Drive Name'
    },
    {
        name: 'capacity',
        label: 'used capacity',
        type: 'capacity'
    }
]);

const disabledModes = deepFreeze([
    'DECOMMISSIONED',
    'DECOMMISSIONING'
]);

class DriveNodeRowViewModel {
    name = '';
    mount = ko.observable();
    capacity = ko.observable();
    disabled = ko.observable();
    rowCss = ko.observable();
    isSelected = ko.observable();
    selected = ko.pureComputed({
        read: this.isSelected,
        write: this.onToggle,
        owner: this
    });

    constructor({ table }) {
        this.table = table;
    }

    onToggle(val) {
        this.table.onToggleNode(this.name, val);
    }
}

class EditHostStorageDrivesModalViewModel extends ConnectableViewModel {
    formName = this.constructor.name;
    fields =  ko.observable();
    host = '';
    isLastService = false;
    columns = columns;
    nodeState = {};
    rows = ko.observableArray()
        .ofType(DriveNodeRowViewModel, { table: this });


    selectState(state, params) {
        const { hosts, forms } = state;
        return [
            params.host,
            hosts && hosts.items[params.host].services,
            forms[this.formName]
        ];
    }


    mapStateToProps(host, services, form) {
        if (!services) {
            return;
        }

        const { endpoint, storage } = services;
        const nodesState = form ? getFieldValue(form, 'nodesState') : {};
        const rows = storage.nodes.map(node => ({
            name: node.name,
            mount: node.mount,
            capacity: getNodeOrHostCapacityBarValues(node),
            isSelected: Boolean(nodesState[node.name])
        }));

        ko.assignToProps(this, {
            host,
            isLastService: disabledModes.includes(endpoint.mode),
            nodesState,
            rows,
            fields: !form ? {
                serviceState: storage.enabled,
                nodesState: keyByProperty(
                    storage.nodes,
                    'name',
                    node => !disabledModes.includes(node.mode)
                )
            } : undefined
        });
    }

    onValidate({ serviceState, nodesState }) {
        const errors = {};

        if (serviceState && Object.values(nodesState).every(val => !val)) {
            errors.nodesState = 'Please select at least one drive or disable the service';
        }

        return errors;
    }

    onToggleNode(node, select) {
        const nodesState = {
            ...this.nodesState,
            [node]: select
        };

        this.dispatch(updateForm(this.formName, { nodesState }));
    }

    onSubmit({ serviceState, nodesState }) {
        const action = serviceState ?
            toggleHostNodes(this.host, nodesState) :
            openDisableHostStorageWarningModal(this.host, this.isLastService);

        this.dispatch(
            closeModal(),
            action
        );
    }

    onSelectAll() {
        const nodesState = mapValues(this.nodesState, () => true);
        this.dispatch(updateForm(this.formName, { nodesState }));
    }

    onClearAll() {
        const nodesState = mapValues(this.nodesState, () => false);
        this.dispatch(updateForm(this.formName, { nodesState }));
    }

    onCancel() {
        this.dispatch(closeModal());
    }
}

export default {
    viewModel: EditHostStorageDrivesModalViewModel,
    template: template
};
