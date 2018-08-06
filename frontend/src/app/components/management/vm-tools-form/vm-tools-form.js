/* Copyright (C) 2016 NooBaa */

import template from './vm-tools-form.html';
import ConnectableViewModel from 'components/connectable';
import ko from 'knockout';
import { realizeUri } from 'utils/browser-utils';
import * as routes from 'routes';
import { requestLocation, installVMTools } from 'action-creators';

class VMToolsFormViewModel extends ConnectableViewModel {
    dataReady = ko.observable();
    isExpanded = ko.observable();
    canInstall = ko.observable();
    isInstalled = ko.observable();
    stateText = ko.observable();
    buttonTooltip = ko.observable();
    toggleUri = '';

    selectState(state) {
        const { system = {}, location } = state;

        return [
            system.vmTools,
            location
        ];
    }

    mapStateToProps(vmToolsState, location) {
        if (!vmToolsState) {
            ko.assignToProps(this, {
                dataReady: false,
                isExpanded: false,
                stateText: ''
            });

        } else {
            const isExpanded = location.params.section === 'vmtools';

            ko.assignToProps(this, {
                dataReady: true,
                isExpanded: isExpanded,
                canInstall:
                    vmToolsState !== 'NOT_SUPPORTED' &&
                    vmToolsState !== 'INSTALLED',
                isInstalled: vmToolsState === 'INSTALLED',
                toggleUri: realizeUri(routes.management, {
                    ...location.params,
                    section: isExpanded ? undefined : 'vmtools'
                }),
                stateText:
                    (vmToolsState === 'NOT_SUPPORTED' && 'Not supported by deployment platform') ||
                    (vmToolsState === 'NOT_INSTALLED' && 'Not installed') ||
                    (vmToolsState === 'INSTALLING' && 'Installing') ||
                    (vmToolsState === 'INSTALLED' && 'Installed'),
                buttonTooltip: vmToolsState === 'NOT_SUPPORTED' ?
                    'This operation is not compatible with the deployment platform' :
                    ''
            });
        }
    }

    onToggleSection() {
        this.dispatch(requestLocation(this.toggleUri));
    }

    onInstallVMWareTools() {
        this.dispatch(installVMTools());
    }
}

export default {
    viewModel: VMToolsFormViewModel,
    template: template
};
