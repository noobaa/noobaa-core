import template from './license-sticky.html';
import Disposable from 'disposable';
import { formatSize } from 'utils';
import { freemiumMaxCapacity } from 'config';
// import ko from 'knockout';
// import numeral from 'numeral';
// import moment from 'moment';

class LicenseStickyViewModel extends Disposable{
    constructor() {
        super();

        this.capacityLimit = formatSize(freemiumMaxCapacity);

    }
}

export default {
    viewModel: LicenseStickyViewModel,
    template: template
};
