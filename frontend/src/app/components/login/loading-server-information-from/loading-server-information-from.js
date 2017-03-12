import template from './loading-server-information-from.html';
import BaseViewModel from 'components/base-view-model';
import ko from 'knockout';
import { serverInfo } from 'model';

class LoadingServerInformationFormViewModel extends BaseViewModel {
    constructor() {
        super();

        this.isUnableToActivateModalVisible = ko.pureComputed(
            () => true
            // () => Boolean(
            //     serverInfo() &&
            //     serverInfo().config &&
            //     serverInfo().config.phone_home_connectivity_status !== 'CONNECTED'
            // )
        );
    }
}

export default {
    viewModel: LoadingServerInformationFormViewModel,
    template: template
};
