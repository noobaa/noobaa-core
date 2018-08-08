/* Copyright (C) 2016 NooBaa */

import template from './autocomplete.html';
import ko from 'knockout';
import { deepFreeze, compare } from 'utils/core-utils';
import { escapeRegExp } from 'utils/string-utils';

const keyBlackList = deepFreeze([
    'control',
    'alt',
    'capslock',
    'meta',
    'contextmenu',
    'tab',
    'shift',
    'home',
    'pagedown',
    'pageup',
    'end',
    'clear'
]);

function _normalizeSuggestion(suggestion, phrase, phraseRegExp) {
    const { value = suggestion, remark = '' } = suggestion;
    if (!value.toLowerCase().includes(phrase)) {
        return null;

    } else {
        const [prefix, match , suffix] = value.split(phraseRegExp);
        return { value, prefix, match, suffix, remark };
    }
}

function _compareSuggestions(s1, s2) {
    const r = compare(s1.prefix.length, s2.prefix.length);
    return r || compare(s1.value.toLowerCase(), s2.value.toLowerCase());
}

class AutoCompleteViewModel {
    constructor(params) {
        const {
            value: outerValue = ko.observable(),
            suggestions = [],
            hasFocus = false,
            placeholder = '',
            maxCount = 5
        } = params;

        this.value = ko.observable(outerValue());
        this.text = ko.observable(outerValue());
        this.outerValue = outerValue;
        this.keyboardFocus = ko.observable(-1);
        this.isActive = ko.observable(false);
        this.placeholder = placeholder;
        this.maxCount = maxCount;

        this.valueSub = outerValue.subscribe(value => {
            this.value(value);
            this.text(value);
        });

        this.hasFocus = ko.isWritableObservable(hasFocus) ?
            hasFocus :
            ko.observable(ko.unwrap(hasFocus));

        this.suggestions = ko.pureComputed(() => {
            const value = this.value();
            if (!value) {
                return [];
            }

            const lc = value.toLowerCase();
            const re = new RegExp(`(${escapeRegExp(value)})(.*)$`, 'i');
            return ko.unwrap(suggestions)
                .map(suggestion => _normalizeSuggestion(suggestion, lc, re))
                .filter(Boolean)
                .sort(_compareSuggestions)
                .slice(0, ko.unwrap(this.maxCount));
        });

        this.isListVisible = ko.pureComputed(() =>
            this.isActive() && this.suggestions().length > 0
        );
    }

    onInput(value) {
        this.value(value);
        this.text(value);
    }

    onBlur() {
        const value = this.text();
        this.value(value);
        this.outerValue(value);
        this.isActive(false);
    }

    onKeyDown(_, evt) {
        const key = evt.key.toLowerCase();
        if (keyBlackList.includes(key)){
            return true;
        }

        switch (key) {
            case 'enter': {
                return this.onEnter(evt);
            }
            case 'escape': {
                return this.onEscape(evt);
            }
            case 'arrowup': {
                return this.onArrowUp(evt);
            }
            case 'arrowdown': {
                return this.onArrowDown(evt);
            }
            default: {
                this.isActive(true);
                this.keyboardFocus(-1);
                return true;
            }
        }
    }

    onEnter() {
        const text = this.text();
        this.value(text);
        this.outerValue(text);
        this.isActive(false);
        return true;
    }

    onEscape(evt) {
        if (this.isActive() && this.keyboardFocus() >= 0) {
            this.text(this.value());
            this.keyboardFocus(-1);

            evt.cancelBubble = true;
            if (evt.stopPropagation) {
                evt.stopPropagation();
            }

            return false;
        }

        return true;
    }

    onArrowUp() {
        if (this.isActive()) {
            const kbFocus = Math.max(this.keyboardFocus() - 1, -1);
            const text = kbFocus >= 0 ?
                this.suggestions()[kbFocus].value :
                this.value();

            this.keyboardFocus(kbFocus);
            this.text(text);
        }

        return false;
    }

    onArrowDown() {
        if (this.isActive()) {
            const kbFocus = Math.min(
                this.keyboardFocus() + 1,
                this.suggestions().length - 1
            );
            const { value } = this.suggestions()[kbFocus];

            this.keyboardFocus(kbFocus);
            this.text(value);
        }

        return false;
    }

    onSuggetionMouseDown(value) {
        this.text(value);
        this.value(value);
        this.outerValue(value);
        this.isActive(false);
        this.hasFocus(true);

        return false;
    }

    dispose() {
        this.valueSub.dispose();
    }
}

export default {
    viewModel: AutoCompleteViewModel,
    template: template
};
