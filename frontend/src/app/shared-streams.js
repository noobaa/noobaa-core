import rx from 'rxjs';

// Hold te current application state (route state).
export let appState = new rx.ReplaySubject(1);

// Hold shared system information.
export let systemInfo = new rx.ReplaySubject(1);

// Refresh stream.
export let refresh = new rx.Subject();