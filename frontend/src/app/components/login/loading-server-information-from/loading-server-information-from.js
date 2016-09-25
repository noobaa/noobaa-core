import template from './loading-server-information-from.html';
import Disposable from 'disposable';
import ko from 'knockout';
import { serverInfo } from 'model';

class LoadingServerInformationFromViewModel extends Disposable{
    constructor() {
        super();

        this.isUnableToActivateModalVisible = ko.pureComputed(
            () => Boolean(
                serverInfo() &&
                serverInfo().config &&
                serverInfo().config.phone_home_connectivity_status !== 'CONNECTED'
            )
        );
    }
}

export default {
    viewModel: LoadingServerInformationFromViewModel,
    template: template
};
