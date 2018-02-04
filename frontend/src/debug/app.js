import MessageListViewModel from './message-list';
import ko from 'knockout';
import { state$, action$ } from 'state';
import numeral from 'numeral';

function _highlightJson(json) {
    json = json
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');

    return json.replace(
        /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null|undefined)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g,
        match => {
            let cls = '';
            if (match.startsWith('"')) {
                if (match.endsWith(':')) {
                    cls = 'key';
                } else {
                    cls = 'string';
                }
            } else if (match === 'true' || match === 'false') {
                cls = 'boolean';
            } else if (match === 'null') {
                cls = 'null';
            } else if (!Number.isNaN(Number(match))) {
                cls = 'number';
            }
            return `<span class="${cls}">${match}</span>`;
        }
    );
}

function _stringify(object, highlight = false, empty = '') {
    const json = (JSON.stringify(object, null, 2) || '')
        .replace(/\\n/g, '\n');

    return json ?
        (highlight ? _highlightJson(json) : json) :
        empty;
}

function _diff(curr, prev, diffs = [], path = '') {
    if (Array.isArray(curr)) {
        if (Array.isArray(prev)) {
            const len = Math.max(curr.length, prev.length);
            for (let i = 0; i < len; ++i) {
                _diff(curr[i], prev[i], diffs, `${path}[${i}]`);
            }

        } else {
            diffs.push({
                path: path,
                toValue: curr,
                form: prev
            });
        }

    } else if (curr === null) {
        if (prev !== null) {
            diffs.push({
                path: path || '.',
                fromValue: prev,
                toValue: curr
            });
        }

    } else if (typeof curr === 'object'){
        if (typeof prev === 'object') {
            const keys = new Set([
                ...Object.keys(curr),
                ...Object.keys(prev)
            ]);

            for (const key of keys) {
                _diff(curr[key], prev[key], diffs, `${path}.${key}`);
            }

        } else {
            diffs.push({
                path: path || '.',
                form: prev,
                toValue: curr
            });
        }

    } else if (curr !== prev) {
        diffs.push({
            path: path || '.',
            fromValue: prev,
            toValue: curr
        });
    }

    return diffs;
}

function _formatDiff(diff) {
    return diff.map(record => {
        const { path, fromValue, toValue } = record;

        const parts = [];
        if (fromValue) {
            const html = _stringify(fromValue, true)
                .split('\n')
                .map(line => ` <span class="prefix">-</span>  ${line}`)
                .join('\n');
            parts.push(`<span class="json unset">${html}</span>`);
        }

        if (toValue) {
            const html = _stringify(toValue, true)
                .split('\n')
                .map(line => ` <span class="prefix">+</span>  ${line}`)
                .join('\n');
            parts.push(`<span class="json set">${html}</span>`);
        }

        return {
            heading: path,
            html: parts.join('\n')
        };
    });
}

export default class AppViewModel {
    targetId = '';
    title = ko.observable();
    filter = ko.observable();
    hasHiddenMessages = ko.observable();
    hiddenCount = ko.observable();
    messageList = new MessageListViewModel();
    isMessageSelected = ko.observable();
    actionPayload = ko.observable();
    fullState = ko.observable();
    stateDiff = ko.observable();
    selectedStateTab = ko.observable();

    constructor() {
        this.sub = state$
            .subscribe(state => this.onState(state));
    }

    onState(state) {
        const { messages, filter, targetId, stateView } = state;
        const upperCasedFilter = state.filter.toUpperCase();
        const filteredMessages = state.messages
            .filter(message => {
                const actionType = message.action.type;
                return actionType.includes(upperCasedFilter);
            });
        const hiddenCount = messages.length - filteredMessages.length;
        const selected = filteredMessages.find(message => message.timestamp === state.selectedMessage);

        this.targetId = targetId;
        this.title(`Noobaa Debug Console - ${targetId}`);
        this.filter(filter);
        this.hasHiddenMessages(hiddenCount > 0);
        this.hiddenCount(numeral(hiddenCount).format(','));
        this.messageList.onState(filteredMessages, state.selectedMessage);
        this.selectedStateTab(stateView);

        if (selected) {
            this.isMessageSelected(true);
            this.actionPayload(_stringify(selected.action.payload, true, '[No Payload]'));
            this.fullState(_stringify(selected.state, true));

            const prevIndex = messages.findIndex(message => message === selected) - 1;
            const prev = messages[prevIndex] || {};
            const diff = _diff(selected.state, prev.state);
            this.stateDiff(diff.length && _formatDiff(diff));

        } else {
            this.isMessageSelected(false);
            this.actionPayload('');
            this.fullState('');
            this.stateDiff('');
        }

    }

    onEmptyLog() {
        action$.onNext({ type: 'DROP_MESSAGES' });
    }

    onFindConsole() {
        global.open(null, `NooBaa:${this.targetId}`);
    }

    onFilterMessages(text) {
        action$.onNext({
            type: 'SET_MESSAGE_FILTER',
            payload: { filter: text }
        });
    }

    onSelectRow(row) {
        const { timestamp } = row;
        action$.onNext({
            type: 'SELECT_MESSAGE',
            payload: { timestamp }
        });
    }

    onShowAllMessages() {
        action$.onNext({
            type: 'SET_MESSAGE_FILTER',
            payload: { filter: '' }
        });
    }

    onFullStateTab() {
        this._selectStateView('full');
    }

    onStateDiffsTab() {
        this._selectStateView('diff');
    }

    _selectStateView(view) {
        action$.onNext({
            type: 'SELECTE_STATE_VIEW',
            payload: { view }
        });
    }

    dispose() {
        this.sub.dispose();
    }
}
