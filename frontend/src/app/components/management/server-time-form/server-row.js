import BaseViewModel from 'components/base-view-model';
import ko from 'knockout';
import { systemInfo } from 'model';
import { deepFreeze } from 'utils/core-utils';

const stateIconMapping = deepFreeze({
    CONNECTED: {
        name: 'healthy',
        css: 'success',
        tooltip: 'Healthy'
    },

    IN_PROGRESS: {
        name: 'in-progress',
        css: 'warning',
        tooltip: 'In Progress'
    },

    DISCONNECTED: {
        name: 'problem',
        css: 'error',
        tooltip: 'Problem'
    }
});

export default class ServerRowViewModel extends BaseViewModel {
    constructor(server, showTimeSettingsModal ) {
        super();

        this.state = ko.pureComputed(
            () => server() ? stateIconMapping[server().status] : ''
        );

        this.serverName = ko.pureComputed(
            () => {
                if (!server()) {
                    return '';
                }

                const { secret, hostname } = server();
                const masterSecret = systemInfo() && systemInfo().cluster.master_secret;
                const suffix = secret === masterSecret ? '(Master)' : '';
                return `${hostname}-${secret} ${suffix}`;

            }
        );

        this.address = ko.pureComputed(
            () => server() ? server().address : ''
        );

        this.timeSettings = ko.pureComputed(
            () => server() && (
                server().ntp_server ? 'network time (NTP)' : 'maunal server time'
            )
        );

        this.ntpServer = ko.pureComputed(
            () => (server() && server().ntp_server) || 'Not Configured'
        );

        const timezone = ko.pureComputed(
            () => server() && server().timezone
        );

        const time = ko.observableWithDefault(
            () => server() && server().time_epoch * 1000
        );

        this.time = time.extend({
            formatTime: {
                format: 'DD MMM YYYY HH:mm:ss ([GMT]Z)',
                timezone: timezone
            }
        });

        this.addToDisposeList(
            setInterval(
                () => time() && time(time() + 1000),
                1000
            ),
            clearInterval
        );

        this.actions = {
            text: 'Edit',
            click: showTimeSettingsModal
        };
    }
}
