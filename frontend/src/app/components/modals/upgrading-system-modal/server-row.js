import ko from 'knockout';
import { deepFreeze } from 'utils/core-utils';

const icons = deepFreeze({
    UPGRADING: {
        name: 'working',
        css: 'warning',
        tooltip: 'Upgrading'
    },
    UPGRADED: {
        name: 'healthy',
        css: 'success',
        tooltip: 'Upgrade Completed'
    }
});

export default class serverRowViewModel {
    constructor() {
        this.icon = ko.observable();
        this.name = ko.observable();
        this.markAsMaster = ko.observable();
    }

    onState(server) {
        const { progress = 0 } = server.upgrade;
        const icon = icons[progress < 1 ? 'UPGRADING' : 'UPGRADED'];
        const name = `${server.hostname}-${server.secret}`;

        this.icon(icon);
        this.name(name);
        this.markAsMaster(server.isMaster);
    }
}
