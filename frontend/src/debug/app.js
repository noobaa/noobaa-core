/* Copyright (C) 2016 NooBaa */

import MessageListViewModel from './message-list';
import ko from 'knockout';
import { state$, action$ } from 'state';
import numeral from 'numeral';
import { buildHtmlTree, diff, wrap } from 'utils';
import zlib from 'zlib';
import { Buffer } from 'buffer';

const fileReaders = {
    'application/x-gzip': async file => {
        const bytes = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = evt => resolve(Buffer.from(evt.target.result));
            reader.onerror = err => reject(err);
            reader.readAsArrayBuffer(file);
        });

        const text = await new Promise((resolve, reject) => {
            zlib.gunzip(bytes, (err, str) => {
                if (err) {
                    reject(str);
                } else {
                    resolve(str.toString());
                }
            });
        });

        return JSON.parse(text);
    },

    'application/json': async file => {
        const text = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = evt => resolve(Buffer.from(evt.target.result));
            reader.onerror = err => reject(err);
            reader.readAsText(file);
        });

        return JSON.parse(text);
    }
};

function _formatDiff(diff) {
    return diff.map(record => {
        const { path, fromValue, toValue } = record;

        const parts = [];
        if (fromValue) {
            parts.push(wrap(buildHtmlTree(fromValue, '-'), 'inspector unset'));
        }

        if (toValue) {
            parts.push(wrap(buildHtmlTree(toValue, '+'), 'inspector set'));
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
    isAttached = ko.observable();
    lastSelected = null;

    constructor() {
        this.sub = state$
            .subscribe(state => this.onState(state));
    }

    onState(state) {
        const { messages, filter, targetId, stateView } = state;
        const filters = state.filter.toUpperCase().split(' ');
        const filteredMessages = state.messages
            .filter(message => {
                const actionType = message.action.type;
                return filters.every(filter => actionType.includes(filter));
            });
        const hiddenCount = messages.length - filteredMessages.length;
        const selected = filteredMessages.find(message => message.id === state.selectedMessage);

        this.targetId = targetId;
        this.title(`Noobaa Debug Console - ${targetId || 'Not Attached'}`);
        this.filter(filter);
        this.hasHiddenMessages(hiddenCount > 0);
        this.hiddenCount(numeral(hiddenCount).format(','));
        this.messageList.onState(filteredMessages, state.selectedMessage);
        this.selectedStateTab(stateView);
        this.isAttached(Boolean(targetId));

        if (selected) {
            if (this.lastSelected !== selected) {
                const { payload } = selected.action;
                this.lastSelected = selected;
                this.isMessageSelected(true);
                this.actionPayload(payload ? buildHtmlTree(payload) : '[No Payload]');
                this.fullState(buildHtmlTree(selected.state));

                const prevIndex = messages.findIndex(message => message === selected) - 1;
                const prev = messages[prevIndex] || {};
                const diffResult = diff(selected.state, prev.state);
                this.stateDiff(diffResult.length && _formatDiff(diffResult));
            }


        } else {
            this.lastSelected = null;
            this.isMessageSelected(false);
            this.actionPayload('');
            this.fullState('');
            this.stateDiff('');
        }

    }

    onEmptyLog() {
        action$.next({ type: 'DROP_MESSAGES' });
    }

    onFindConsole() {
        global.open(null, `NooBaa:${this.targetId}`);
    }

    onFilterMessages(text) {
        action$.next({
            type: 'SET_MESSAGE_FILTER',
            payload: { filter: text }
        });
    }

    onSelectRow(row) {
        const { id } = row;
        action$.next({
            type: 'SELECT_MESSAGE',
            payload: { id }
        });
    }

    onShowAllMessages() {
        action$.next({
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

    async onSelectFile(_, evt) {
        try {
            const [file] = evt.target.files;
            const reader = fileReaders[file.type];
            if (!reader) {
                throw new Error('Invalid file type');
            }
            if (file.size > 3 * (1024 ** 2)) { // 3MB
                throw new Error('File too big');
            }

            const { log } = await reader(file);
            action$.next({
                type: 'REPLACE_MESSAGES',
                payload: log
            });
        } catch (e) {
            alert(e.message);
        }
        evt.target.value = '';
    }

    _selectStateView(view) {
        action$.next({
            type: 'SELECTE_STATE_VIEW',
            payload: { view }
        });
    }

    dispose() {
        this.sub.dispose();
    }
}
