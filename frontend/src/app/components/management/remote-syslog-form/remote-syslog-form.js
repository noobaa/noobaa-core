/* Copyright (C) 2016 NooBaa */

import template from './remote-syslog-form.html';
import ConnectableViewModel from 'components/connectable';
import ko from 'knockout';
import { deepFreeze, clamp } from 'utils/core-utils';
import { realizeUri } from 'utils/browser-utils';
import { isIPOrDNSName } from 'utils/net-utils';
import { isFormDirty, getFieldValue } from 'utils/form-utils';
import * as routes from 'routes';
import { requestLocation,  unsetRemoteSyslog, setRemoteSyslog } from 'action-creators';

const sectionName = 'remote-syslog';
const defaultPorts = deepFreeze({
    UDP: 5014,
    TCP: 514
});

const defaultProtocol = 'UDP';
const portValMessage = 'Please enter a port number between 1 and 65535';

class RemoteSyslogFormViewModel extends ConnectableViewModel {
    formName = this.constructor.name;
    tcpPort = defaultPorts.TCP;
    protocolOptions = Object.keys(defaultPorts);
    isExpanded = ko.observable();
    isDirtyMarkerVisible = ko.observable();
    toggleUri = '';
    syslogUri = ko.observable();
    fields = ko.observable();

    selectState(state) {
        const { system, location, forms } = state;
        return [
            system,
            location,
            forms[this.formName]
        ];
    }


    mapStateToProps(systemState, location, form) {
        if (!systemState) {
            ko.assignToProps(this, {
                isDirtyMarkerVisible: false,
                syslogUri: ''
            });

        } else {
            const { remoteSyslog } = systemState;
            const enabled = form ? getFieldValue(form, 'enabled') : Boolean(remoteSyslog);
            const isDirtyMarkerVisible = form ? isFormDirty(form) : false;

            const protocol =
                (form && getFieldValue(form, 'protocol')) ||
                (remoteSyslog && remoteSyslog.protocol) ||
                defaultProtocol;

            const address =
                (form && getFieldValue(form, 'address')) ||
                (remoteSyslog && remoteSyslog.address) ||
                '';

            const udpPort =
                (form && getFieldValue(form, 'udpPort')) ||
                (remoteSyslog && protocol === 'UDP' && remoteSyslog.port) ||
                defaultPorts.UDP;

            const port = protocol === 'UDP' ? udpPort : defaultPorts.TCP;
            const syslogUri = enabled ? `${protocol.toLowerCase()}://${address}:${port}` : 'Not set';
            const { system, tab = 'settings', section } = location.params;
            const isExpanded = section === sectionName;
            const toggleSection = isExpanded ? undefined : sectionName;
            const toggleUri = realizeUri(
                routes.management,
                { system, tab, section: toggleSection }
            );

            ko.assignToProps(this, {
                isDirtyMarkerVisible,
                syslogUri,
                isExpanded,
                toggleUri,
                fields: !form ? {
                    enabled,
                    protocol,
                    address,
                    udpPort
                } : undefined
            });
        }
    }

    onValidate(values) {
        const { address, udpPort, enabled } = values;
        const errors = {};

        if (enabled) {
            if (!isIPOrDNSName(address)) {
                errors.address = 'Please enter an IP or DNS name';
            }

            if (clamp(udpPort, 1, 65535) !== udpPort)  {
                errors.udpPort = portValMessage;
            }
        }

        return errors;
    }

    onSubmit({ enabled, protocol, address, udpPort }) {
        if (enabled) {
            const port = protocol === 'UDP' ? udpPort : defaultPorts.TCP;
            this.dispatch(setRemoteSyslog(protocol, address, port));

        } else {
            this.dispatch(unsetRemoteSyslog());
        }
    }

    onToggleSection() {
        this.dispatch(requestLocation(this.toggleUri));
    }
}

export default {
    viewModel: RemoteSyslogFormViewModel,
    template: template
};
