import template from './cluster-summary.html';
import Disposable from 'disposable';
// import ko from 'knockout';
// import numeral from 'numeral';
// import moment from 'moment';

class ClusterSummaryViewModel extends Disposable{
    constructor() {
        super();

    }
}

export default {
    viewModel: ClusterSummaryViewModel,
    template: template
};
