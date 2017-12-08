/* Copyright (C) 2016 NooBaa */

import template from './token-field.html';
import ko from 'knockout';
import { splice } from 'utils/string-utils';

const enterKeyCode = 13;
const backspaceKeyCode = 8;
const tokenSeperator = '\n';

class TokenFieldViewModel {
    constructor({
        tokens = ko.observable([]),
        disabled = false,
        placeholder = 'Type to add tokens'
    }) {
        this.text = ko.observable('');
        this.disabled = disabled;
        this.placeholder = ko.pureComputed(
            () => this.hasFocus() ? '' : ko.unwrap(placeholder)
        );

        this.list = ko.observableArray(Array.from(ko.unwrap(tokens) || []));
        this.selection = ko.observable(0);
        this.hasFocus = ko.observable(false);
        this.hasFocus.subscribe(f => !f && this.onBlur());

        this.scroll = ko.observable().extend({
            notify: 'always'
        });

        this.eventHandlers = {
            mousedown: this.onMouseDown,
            paste: this.onPaste,
            keypress: this.onKeyPress,
            keydown: this.onKeyDown
        };

        this.tokens = tokens;
        this.tokensSub = tokens.subscribe(
            tokens => this.list(Array.from(tokens))
        );
    }

    onMouseDown() {
        this.hasFocus(true);
    }

    onKeyPress(_, evt) {
        if (evt.which !== enterKeyCode) {
            return true;
        }

        this.commitText();
        evt.preventDefault();
    }

    onKeyDown(_, { which }) {
        if (which === backspaceKeyCode && !this.text()) {
            this.text(this.list.pop());
        } else {
            return true;
        }
    }

    onBlur() {
        this.commitText();
        this.tokens(Array.from(this.list()));
    }

    onPaste(_, { clipboardData }) {
        const text = clipboardData.getData('text');
        if (!text) {
            return;
        }

        const { start, end } = this.selection();
        const list = splice(this.text(), start, end, text)
            .split(tokenSeperator)
            .filter(token => Boolean(token.trim()));

        if (list.length > 1) {
            this.text('');
            this.list.push(...list);
            this.scroll(1);
        } else {
            return true;
        }
    }

    onRemoveToken(index) {
        this.list.splice(index, 1);
        this.hasFocus(true);
    }

    dispose() {
        this.tokensSub.dispose();
    }

    commitText() {
        const text = this.text().trim();
        if (!text) return;

        this.list.push(text);
        this.text('');
        this.scroll(1);
    }
}

export default {
    viewModel: TokenFieldViewModel,
    template: template
};
