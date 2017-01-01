import template from './system-health.html';
import BaseViewModel from 'base-view-model';
// import ko from 'knockout';
// import numeral from 'numeral';
// import moment from 'moment';

class SystemHealthViewModel extends BaseViewModel {
    constructor() {
        super();

    }
}

export default {
    viewModel: SystemHealthViewModel,
    template: template
};
