/* Copyright (C) 2025 NooBaa */
'use strict';

const { IncomingWebhook } = require('@slack/webhook');

async function main() {
  const [,, webhookUrl, status, message] = process.argv;
  if (!webhookUrl || !status || !message) {
    console.error('Usage: node slack_notifier.js <webhook_url> <status> <message>');
    process.exit(0);
  }

  try {
    const webhook = new IncomingWebhook(webhookUrl);
    const emoji = status === 'success' ? '✅' : '❌';
    const text = emoji + ' ' + message;

    // Send message only
    await webhook.send({
      text: text
    });

  } catch (error) {
    console.error('Notification failed:', error.message);
  }

  process.exit(0);
}

main();
