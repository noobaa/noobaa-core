/* Copyright (C) 2016 NooBaa */

import template from './edit-host-storage-drives-modal.html';
import Observer from 'observer';
import DriveNodeRowViewModel from './drive-node-row';
import { state$, action$ } from 'state';
import { deepFreeze, keyByProperty, mapValues } from 'utils/core-utils';
import { getFieldValue } from 'utils/form-utils';
import { getMany } from 'rx-extensions';
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

class EditHostStorageDrivesModalViewModel extends Observer {
    formName = this.constructor.name;
    fields =  ko.observable();
    host = '';
    isLastService = false;
    columns = columns;
    rows = ko.observableArray();
    nodeState = {};
    rowParams = {
        onToggle: this.onToggleNode.bind(this)
    };

    constructor({ host }) {
        super();

        this.host = ko.unwrap(host);

        this.observe(
            state$.pipe(
                getMany(
                    ['hosts', 'items', this.host, 'services'],
                    ['forms', this.formName]
                )
            ),
            this.onState
        );
    }

    onState([ services, form ]) {
        if (!services) return;

        const { endpoint, storage } = services;
        const nodesState = form ? getFieldValue(form, 'nodesState') : {};
        const rows = storage.nodes
            .map((node, i) => {
                const row = this.rows()[i] || new DriveNodeRowViewModel(this.rowParams);
                row.onNode(node, Boolean(nodesState[node.name]));
                return row;
            });

        this.isLastService = disabledModes.includes(endpoint.mode);
        this.rows(rows);
        this.nodesState = nodesState;

        if (!this.fields()) {
            this.fields({
                serviceState: storage.enabled,
                nodesState: keyByProperty(
                    storage.nodes,
                    'name',
                    node => !disabledModes.includes(node.mode)
                )
            });
        }
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

        action$.next(updateForm(this.formName, { nodesState }));
    }

    onSubmit({ serviceState, nodesState }) {
        const action = serviceState ?
            toggleHostNodes(this.host, nodesState) :
            openDisableHostStorageWarningModal(this.host, this.isLastService);

        action$.next(closeModal());
        action$.next(action);
    }

    onSelectAll() {
        const nodesState = mapValues(this.nodesState, () => true);
        action$.next(updateForm(this.formName, { nodesState }));
    }

    onClearAll() {
        const nodesState = mapValues(this.nodesState, () => false);
        action$.next(updateForm(this.formName, { nodesState }));
    }

    onCancel() {
        action$.next(closeModal());
    }
}

export default {
    viewModel: EditHostStorageDrivesModalViewModel,
    template: template
};
