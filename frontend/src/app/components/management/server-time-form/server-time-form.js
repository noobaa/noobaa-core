import template from './server-time-form.html';
import Disposable from 'disposable';
import ServerRow from './server-row';
import ko from 'knockout';
import { systemInfo } from 'model';
import { deepFreeze } from 'utils/core-utils';

const columns = deepFreeze([
    {
        name: 'state',
        label: '',
        type: 'icon'
    },
    {
        name: 'hostname'
    },
    {
        name: 'address',
        label: 'IP Address'
    },
    {
        name: 'timeSettings'
    },
    {
        name: 'time',
        label: 'server time'
    },
    {
        name: 'actions',
        type: 'button',
        label: ''
    }
]);

class ServerTimeFormViewModel extends Disposable{
    constructor({ isCollapsed }) {
        super();

        this.columns = columns;
        this.isCollapsed = isCollapsed;


        const cluster = ko.pureComputed(
            () => systemInfo() && systemInfo().cluster
        );

        this.servers = ko.pureComputed(
            () => cluster() ? cluster().shards[0].servers : []
        );

        const master = ko.pureComputed(
            () => this.servers().find(
                server => server.secret === (cluster() || {}).master_secret
            )
        );

        this.masterTime = ko.observableWithDefault(
            () => master() && master().time_epoch * 1000
        );

        this.formattedMasterTime = this.masterTime.extend({
            formatTime: 'DD MMM YYYY HH:mm:ss ([GMT]Z)'
        });

        this.editContext = ko.observable();
        this.isServerTimeSettingsModalVisible = ko.observable(false);

        this.addToDisposeList(
            setInterval(
                () => this.masterTime() && this.masterTime(this.masterTime() + 1000),
                1000
            ),
            clearInterval
        );
    }

    createRow(server) {
        return new ServerRow(
            server,
            () => {
                this.editContext(server().secret);
                this.isServerTimeSettingsModalVisible(true);
            }
        );
    }

    hideServerTimeSettingsModal()  {
        this.isServerTimeSettingsModalVisible(false);
    }
}

export default {
    viewModel: ServerTimeFormViewModel,
    template: template
};
