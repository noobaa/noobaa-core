import template from './server-summary.html';
import Disposable from 'disposable';
// import ko from 'knockout';
// import numeral from 'numeral';
// import moment from 'moment';

class ServerSummaryViewModel extends Disposable{
    constructor() {
        super();

    }
}

export default {
    viewModel: ServerSummaryViewModel,
    template: template
};
