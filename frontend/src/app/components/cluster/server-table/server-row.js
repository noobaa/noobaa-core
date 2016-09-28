import Disposable from 'disposable';
import ko from 'knockout';
import numeral from 'numeral';
import { deepFreeze } from 'utils';

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
    constructor(server) {
        super();

        this.state = ko.pureComputed(
            () => server() ? stateIconMapping[server().status] : ''
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

        this.actions = ko.pureComputed(
            () => server() && server().secret
        );
    }
}
