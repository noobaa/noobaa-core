import template from './debug-mode-sticky.html';
import Disposable from 'disposable';
import { systemInfo } from 'model';
import { setSystemDebugLevel } from 'actions';
import ko from 'knockout';

class DebugModeStickyViewModel extends Disposable{
    constructor() {
        super();

        this.isActive = ko.pureComputed(
            () => !!systemInfo() && systemInfo().debug_level > 0
        );
    }

    lowerDebugLevel() {
        setSystemDebugLevel(0);
    }
}

export default {
    viewModel: DebugModeStickyViewModel,
    template: template
};

