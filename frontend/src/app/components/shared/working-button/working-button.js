import template from './working-button.html';
import Disposable from 'disposable';
// import ko from 'knockout';
// import numeral from 'numeral';
// import moment from 'moment';

class WorkingBtnViewModel extends Disposable{
    constructor({ working, workingLabel, click, disabled }) {
        super();

        this.working = working;
        this.label = workingLabel;
        this.click = click;
        this.disabled = disabled;

    }
}

export default {
    viewModel: WorkingBtnViewModel,
    template: template
};
