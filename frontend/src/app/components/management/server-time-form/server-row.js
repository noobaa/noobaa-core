import Disposable from 'disposable';
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

export default class ServerRowViewModel extends Disposable {
    constructor(server, showTimeSettingsModal ) {
        super();

        this.state = ko.pureComputed(
            () => server() ? stateIconMapping[server().status] : ''
        );

        this.hostname = ko.pureComputed(
            () => {
                let masterSecret = systemInfo() && systemInfo().cluster.master_secret;
                let isMaster = server().secret === masterSecret;
                return server() ?
                    `${server().hostname} ${ isMaster ? '(Master)' : '' }` :
                    '';
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

        const time = ko.observableWithDefault(
            () => server() && server().time_epoch * 1000
        );

        this.addToDisposeList(
            setInterval(
                () => time() && time(time() + 1000),
                1000
            ),
            clearInterval
        );

        this.time = time.extend({
            formatTime: { format: 'DD MMM YYYY HH:mm:ss ([GMT]Z)' }
        });

        this.actions = {
            text: 'Edit',
            click: showTimeSettingsModal
        };
    }
}
