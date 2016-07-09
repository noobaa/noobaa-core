import template from './editor.html';
import BaseViewModel from 'base-view-model';

class EditorViewModel extends BaseViewModel {
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
