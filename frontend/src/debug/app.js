/* Copyright (C) 2016 NooBaa */

import MessageListViewModel from './message-list';
import ko from 'knockout';
import { state$, action$ } from 'state';
import numeral from 'numeral';
import { buildHtmlTree, diff, wrap } from 'utils';

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
            const { payload } = selected.action;
            this.isMessageSelected(true);
            this.actionPayload(payload ? buildHtmlTree(payload) : '[No Payload]');
            this.fullState(buildHtmlTree(selected.state));

            const prevIndex = messages.findIndex(message => message === selected) - 1;
            const prev = messages[prevIndex] || {};
            const diffResult = diff(selected.state, prev.state);
            this.stateDiff(diffResult.length && _formatDiff(diffResult));

        } else {
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
        const { timestamp } = row;
        action$.next({
            type: 'SELECT_MESSAGE',
            payload: { timestamp }
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
