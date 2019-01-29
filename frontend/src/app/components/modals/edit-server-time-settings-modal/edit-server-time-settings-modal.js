/* Copyright (C) 2016 NooBaa */

import template from './edit-server-time-settings-modal.html';

import ConnectableViewModel from 'components/connectable';
import ko from 'knockout';
import { closeModal, updateServerTimeSettings } from 'action-creators';
import { isIPOrDNSName } from 'utils/net-utils';
import { isFieldTouched, getFieldValue } from 'utils/form-utils';
import { api } from 'services';
import { timeTickInterval } from 'config';
import moment from 'moment-timezone';

const manualTimeTooltip =  'Mannual time cannot be used in a cluster environment';

class EditServerTimeSettingsModalViewModel extends ConnectableViewModel {
    formName = this.constructor.name;
    serverSecret = '';
    serverHostname = '';
    time = ko.observable();
    incTime = true;
    formFields = ko.observable();
    asyncTriggers = [
        'configType',
        'ntpServer'
    ];
    configTypes = [
        {
            label: 'Manual Time',
            value: 'MANUAL',
            disabled: ko.observable(),
            tooltip: ko.observable()
        },
        {
            label: 'Network Time (NTP)',
            value: 'NTP'
        }
    ];

    constructor(params, inject) {
        super(params, inject);

        this.ticker = setInterval(
            () => this.onTick(),
            timeTickInterval
        );
    }

    selectState(state, params) {
        const { servers } = state.topology || {};
        return [
            servers && servers[params.serverSecret],
            Object.keys(servers || {}).length > 1,
            state.forms[this.formName]
        ];
    }

    mapStateToProps(server, clusteredEnv, form) {
        if (server) {
            const { secret, hostname, timezone, ntp, clockSkew } = server;
            const timeWasTouched = form ? isFieldTouched(form, 'time') : false;
            const time = timeWasTouched ? getFieldValue(form, 'time') : Date.now() + clockSkew;

            ko.assignToProps(this, {
                incTime: !timeWasTouched,
                serverSecret: secret,
                serverHostname: hostname,
                configTypes: {
                    0: {
                        disabled: clusteredEnv,
                        tooltip: clusteredEnv ? manualTimeTooltip :''
                    }
                },
                time,
                formFields: !form ? {
                    configType: ntp ? 'NTP' : 'MANUAL',
                    timezone: timezone,
                    time,
                    ntpServer: ntp ? ntp.server : ''
                } : undefined
            });
        }
    }

    onValidate(values) {
        const errors = {};

        const { configType, ntpServer } = values;
        if (configType === 'NTP' && (!ntpServer || !isIPOrDNSName(ntpServer))) {
            errors.ntpServer = 'Please enter an NTP server address';
        }

        return errors;
    }

    async onValidateAsync(values) {
        const errors = {};

        const { configType, ntpServer } = values;
        if (configType == 'NTP') {
            const { valid } = await api.system.attempt_server_resolve({
                server_name: ntpServer
            });

            if (!valid) {
                errors.ntpServer = 'Could not resolve NTP server';
            }
        }

        return errors;
    }

    onTick() {
        if (this.incTime) {
            this.time(this.time() + timeTickInterval);
        }
    }

    onCancel() {
        this.dispatch(
            closeModal()
        );
    }

    onSubmit(values) {
        const { configType, timezone, ntpServer } = values;

        if (configType === 'NTP') {
            this.dispatch(
                updateServerTimeSettings(
                    this.serverSecret,
                    this.serverHostname,
                    timezone,
                    ntpServer,
                    null
                ),
                closeModal()
            );

        } else  {
            const epoch = moment.tz(this.time(), values.timezone).unix();
            this.dispatch(
                updateServerTimeSettings(
                    this.serverSecret,
                    this.serverHostname,
                    timezone,
                    null,
                    epoch
                ),
                closeModal()
            );
        }
    }

    dispose() {
        this.ticker && clearInterval(this.ticker);
        super.dispose();
    }
}

export default {
    viewModel: EditServerTimeSettingsModalViewModel,
    template: template
};
