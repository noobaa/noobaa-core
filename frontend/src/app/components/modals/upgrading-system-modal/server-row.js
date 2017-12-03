import ko from 'knockout';

export default class serverRowViewModel {
    constructor() {
        this.icon = ko.observable();
        this.name = ko.observable();
        this.markAsMaster = ko.observable();
    }

    onState(server) {
        const icon = { css: 'warning', name: 'working' };
        const name = `${server.hostname}-${server.secret}`;

        this.icon(icon);
        this.name(name);
        this.markAsMaster(server.isMaster);
    }
}
