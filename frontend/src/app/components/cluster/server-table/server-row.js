import ko from 'knockout';
import numeral from 'numeral';
import { deepFreeze } from 'utils';

const stateMapping = deepFreeze({
    true: { text: 'connected', css: 'success' },
    false: { text: 'disconnected', css: 'error' }
});

export default class ServerRow {
    constructor(server) {
        this.state = ko.pureComputed(
            () => server() ? stateMapping[server().is_connected] : ''
        );

        this.hostname = ko.pureComputed(
            () => server() ? server().hostname : ''
        );

        this.address = ko.pureComputed(
            () => server() ? server().address : ''
        );

        this.memoryUsage = ko.pureComputed(
            () => server() ? numeral(server().memory_usage).format('%') : 'N/A'
        );

        this.cpuUsage = ko.pureComputed(
            () => server() ? numeral(server().cpu_usage).format('%') : 'N/A'
        );

        this.version = ko.pureComputed(
            () => server() ? server().version : 'N/A'
        );
    }
}
