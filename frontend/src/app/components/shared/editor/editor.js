import template from './editor.html';
import Disposable from 'disposable';

class EditorViewModel extends Disposable {
    constructor({
        label = '',
        visible = true,
        disabled = false,
        insertValMessages = true
    }) {
        super();

        this.label = label;
        this.visible = visible;
        this.disabled = disabled;
        this.insertValMessages = insertValMessages;
    }
}

export default {
    viewModel: EditorViewModel,
    template: template
};
