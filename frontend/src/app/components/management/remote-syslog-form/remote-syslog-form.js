/* Copyright (C) 2016 NooBaa */

import template from './remote-syslog-form.html';
import Observer from 'observer';
import ko from 'knockout';
import { deepFreeze, clamp } from 'utils/core-utils';
import { realizeUri } from 'utils/browser-utils';
import { isIPOrDNSName } from 'utils/net-utils';
import { isFormDirty, getFieldValue } from 'utils/form-utils';
import FormViewModel from 'components/form-view-model';
import * as routes from 'routes';
import { action$, state$ } from 'state';
import { getMany } from 'rx-extensions';
import { requestLocation,  unsetRemoteSyslog, setRemoteSyslog } from 'action-creators';

const sectionName = 'remote-syslog';
const defaultPorts = deepFreeze({
    UDP: 5014,
    TCP: 514
});

const defaultProtocol = 'UDP';
const portValMessage = 'Please enter a port number between 1 and 65535';

class RemoteSyslogFormViewModel extends Observer {
    formName = this.constructor.name;
    tcpPort = defaultPorts.TCP;
    form = null;
    protocolOptions = Object.keys(defaultPorts);
    isExpanded = ko.observable();
    href = ko.observable();
    isFormInitialized = ko.observable();
    isDirtyMarkerVisible = ko.observable();

    constructor() {
        super();

        this.observe(
            state$.pipe(
                getMany(
                    'system',
                    'location',
                    ['forms', this.formName]
                )
            ),
            this.onState
        );
    }

    onState([systemState, location, form]) {
        if (!systemState) {
            this.isFormInitialized(false);
            this.isDirtyMarkerVisible(false);
            return;
        }

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
        const href = enabled ? `${protocol.toLowerCase()}://${address}:${port}` : '';

        const { system, tab = 'settings', section } = location.params;
        const toggleSection = section === sectionName ? undefined : sectionName;
        const toggleUri = realizeUri(
            routes.management,
            { system, tab, section: toggleSection }
        );

        this.href(href);
        this.isExpanded(section === sectionName);
        this.toggleUri = toggleUri;
        this.isDirtyMarkerVisible(isDirtyMarkerVisible);

        if (!form) {
            this.form = new FormViewModel({
                name: this.formName,
                fields: {
                    enabled,
                    protocol,
                    address,
                    udpPort
                },
                onValidate: this.onValidate.bind(this),
                onSubmit: this.onSubmit.bind(this)
            });
            this.isFormInitialized(true);
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
            action$.next(setRemoteSyslog(protocol, address, port));
        } else {
            action$.next(unsetRemoteSyslog());
        }
    }

    onToggleSection() {
        action$.next(requestLocation(this.toggleUri));
    }

    dispose() {
        this.form && this.form.dispose();
        super.dispose();
    }
}

export default {
    viewModel: RemoteSyslogFormViewModel,
    template: template
};
