import template from './token-field.html';
import BaseViewModel from 'components/base-view-model';
import ko from 'knockout';
// import numeral from 'numeral';
// import moment from 'moment';

class TokenFieldViewModel extends BaseViewModel {
    constructor({ tokens = ko.observableArray()  }) {
        super();

        this.tokens = tokens;
        this.text = ko.observable();
        this.hasFocus = ko.observable(false);
    }

    onMouseDown() {
        this.hasFocus(true);
    }

    onKeyPress(_, { which }) {
        if (which !== 13 || !this.text()) {
            return true;
        }

        this._appendToken(this.text());
        this.text('');
    }

    onChange() {
        if (!this.text()) {
            return;
        }

        this._appendToken(this.text());
        this.text('');
    }

    onPaste(_, { clipboardData }) {
        const text = clipboardData.getData('text');
        if (!text) {
            return;
        }

        text.split('\n').forEach(
            token => this._appendToken(token)
        );
    }

    onRemoveToken(index) {
        this.tokens.splice(index, 1);
        this.hasFocus(true);
    }

    _appendToken(token) {
        const text = token.trim();
        if (text) {
            this.tokens.push(text);
        }
    }
}

export default {
    viewModel: TokenFieldViewModel,
    template: template
};
