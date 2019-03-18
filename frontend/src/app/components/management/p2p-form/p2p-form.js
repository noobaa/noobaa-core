/* Copyright (C) 2016 NooBaa */

import template from './p2p-form.html';
import ConnectableViewModel from 'components/connectable';
import ko from 'knockout';
import { isPortNumber } from 'utils/net-utils';
import { getFieldValue, isFormDirty } from 'utils/form-utils';
import { realizeUri } from 'utils/browser-utils';
import * as routes from 'routes';
import { requestLocation, updateP2PSettings } from 'action-creators';

const sectionName = 'p2p';
const notAllowedTooltip = 'Edit P2P Ports in a container environment will be available in the following versions of NooBaa';
const portOptions = [
    { label: 'Single Port', value: 'SINGLE' },
    { label: 'Port Range', value: 'RANGE' }
];

class P2PFormViewModel2 extends ConnectableViewModel {
    formName = this.constructor.name;
    portOptions = portOptions;
    dataReady = ko.observable();
    isExpanded = ko.observable();
    isDirtyMarkerVisible = ko.observable();
    toggleUri = '';
    summary = ko.observable();
    minRangeEnd = ko.observable();
    configDisabled = ko.observable();
    updateButtonTooltip = {
        align: 'start',
        text: ko.observable()
    };
    fields = ko.observable();

    selectState(state) {
        const { system, forms, location, platform } = state;
        return [
            system && system.p2pSettings,
            location,
            forms[this.formName],
            platform && platform.featureFlags.p2pSettingsChange
        ];
    }

    mapStateToProps(p2pSettings, location, form, allowP2PSettingsChange) {
        if (!p2pSettings) {
            ko.assignToProps(this, {
                dataReady: false,
                isExpanded: false,
                summary: 'Port Number: '
            });

        } else {
            const { system, tab, section } = location.params;
            const toggleSection = section === sectionName ? undefined : sectionName;
            const toggleUri = realizeUri(routes.management, { system, tab, section: toggleSection });
            const rangeStart = form ? getFieldValue(form, 'rangeStart') : p2pSettings.tcpPortRange.start;
            const rangeEnd = form ? getFieldValue(form, 'rangeEnd') : p2pSettings.tcpPortRange.end;
            const rangeType = form ? getFieldValue(form, 'rangeType') : (rangeStart === rangeEnd ? 'SINGLE' : 'RANGE');
            const summary = rangeType === 'SINGLE' ?
                `Port Number: ${rangeStart}` :
                `Port Range: ${rangeStart}-${rangeEnd}`;

            ko.assignToProps(this, {
                dataReady: true,
                toggleUri,
                isExpanded: section === sectionName,
                summary,
                isDirtyMarkerVisible: form ? isFormDirty(form) : false,
                minRangeEnd: Math.max(rangeStart + 1, 1),
                configDisabled: !allowP2PSettingsChange,
                updateButtonTooltip: {
                    text: allowP2PSettingsChange ? '' : notAllowedTooltip
                },
                fields: !form ?
                    { rangeType, rangeStart, rangeEnd } :
                    undefined
            });
        }
    }

    onToggleSection() {
        this.dispatch(requestLocation(this.toggleUri));
    }

    onValidate(values) {
        const { rangeType, rangeStart, rangeEnd } = values;
        const errors = {};

        if (!isPortNumber(rangeStart)) {
            errors.rangeStart = 'Please enter a valid port number';

        }

        if (rangeType === 'RANGE') {
            if (!isPortNumber(rangeEnd)) {
                errors.rangeEnd = 'Please enter a valid port number';

            } else if (rangeEnd <= rangeStart) {
                errors.rangeEnd = `Please enter a port number bigger then ${rangeStart}`;
            }
        }

        return errors;
    }

    onSubmit(values) {
        const tcpPortRange = {
            start: values.rangeStart,
            end: values.rangeType === 'SINGLE' ? values.rangeStart : values.rangeEnd
        };
        this.dispatch(updateP2PSettings(tcpPortRange));
    }
}

export default {
    viewModel: P2PFormViewModel2,
    template: template
};
