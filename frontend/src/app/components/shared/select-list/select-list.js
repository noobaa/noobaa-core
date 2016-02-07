import template from "./dropdown.html";
import ko from 'knockout';

class DropdownViewModel {
    constructor(params) {
        this.options = params.options.map(opt => {
            if (opt !== 'object') {
                opt = { value: opt, label: opt.toString(), action: params.action }
            }

            if (opt.label == null) {
                opt.label = opt.value.toString();
            }

            if (typeof opt.action !== 'function') {
                opt.action = params.action;
            }

            return opt;
        });
    }
}

export default {
    viewModel: DropdownViewModel,
    template: template
}