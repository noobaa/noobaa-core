import template from './editor.html';

class EditorViewModel {
    constructor({
        label = '',
        visible = true,
        disabled = false,
        insertValMessages = true
    }) {
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
