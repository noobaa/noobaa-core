import template from './debug-mode-sticky.html';
import Disposable from 'disposable';
import { setSystemDebugLevel } from 'actions';

class DebugModeStickyViewModel extends Disposable{
    constructor() {
        super();

    }

    lowerDebugLevel() {
        setSystemDebugLevel(0);
    }
}

export default {
    viewModel: DebugModeStickyViewModel,
    template: template
};

